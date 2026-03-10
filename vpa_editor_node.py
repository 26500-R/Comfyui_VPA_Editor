import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
import folder_paths
from server import PromptServer
from aiohttp import web
import json
import base64
import io

VPA_DIR = os.path.join(folder_paths.get_output_directory(), "VPA_PNG")
os.makedirs(VPA_DIR, exist_ok=True)

class VPAEditorLoadImage:
    """
    VPA图像加载节点
    - 选择/上传图片
    - 可编辑名称文本框
    - 「加载图片」/「用 VPA Editor 打开」按钮
    - 右侧输出：图像 / 遮罩 / 文本名称 / 图层1-6 / 合并层
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", ),
                "edit_name": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "输入保存名称",
                    },
                ),
            },
            "optional": {
                "mask": ("MASK", {"forceInput": True}),
                "annotation_layer_1": ("IMAGE", {"forceInput": True}),
                "annotation_layer_2": ("IMAGE", {"forceInput": True}),
                "annotation_layer_3": ("IMAGE", {"forceInput": True}),
                "annotation_layer_4": ("IMAGE", {"forceInput": True}),
                "annotation_layer_5": ("IMAGE", {"forceInput": True}),
                "annotation_layer_6": ("IMAGE", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("图像", "遮罩", "文本名称", "图层1", "图层2", "图层3", "图层4", "图层5", "图层6", "合并层")
    FUNCTION = "load_image"
    CATEGORY = "VPAEditor"

    def load_image(self, image, edit_name="", mask=None,
                   annotation_layer_1=None, annotation_layer_2=None, annotation_layer_3=None, 
                   annotation_layer_4=None, annotation_layer_5=None, annotation_layer_6=None):
        
        output_image = image
        if mask is not None:
            output_mask = mask
        else:
            output_mask = torch.zeros((output_image.shape[0], output_image.shape[1], output_image.shape[2]), dtype=torch.float32)

        file_prefix = edit_name if edit_name else "annotation"

        # 辅助函数：构建空白全透明图层
        def get_empty_layer(reference_tensor):
            b, h, w, c = reference_tensor.shape
            empty = torch.zeros((b, h, w, 4), dtype=torch.float32)
            return empty

        empty_layer = get_empty_layer(output_image)
        saved_custom_layers = []

        layers_json_path = os.path.join(VPA_DIR, f"{file_prefix}_layers.json")
        if os.path.exists(layers_json_path):
            try:
                with open(layers_json_path, "r", encoding="utf-8") as f:
                    saved_layers = json.load(f)
                
                for layer_data in saved_layers:
                    visible = layer_data.get("visible", True)
                    image_data = layer_data.get("imageData", "")
                    
                    layer_tensor = empty_layer
                    if image_data and visible:
                        if "," in image_data:
                            image_data = image_data.split(",")[1]
                        image_bytes = base64.b64decode(image_data)
                        layer_img = Image.open(io.BytesIO(image_bytes))
                        layer_np = np.array(layer_img.convert("RGBA")).astype(np.float32) / 255.0
                        layer_tensor = torch.from_numpy(layer_np)[None,]
                    
                    saved_custom_layers.append({
                        "visible": visible,
                        "tensor": layer_tensor,
                        "has_data": bool(image_data)
                    })
            except Exception as e:
                print(f"[VPA Editor] Error loading layers json: {e}")

        # 补齐6个图层的数据，默认空
        while len(saved_custom_layers) < 6:
            saved_custom_layers.append({
                "visible": True,
                "tensor": empty_layer,
                "has_data": False
            })

        # 解析 1~6 层的输出
        input_layers = [
            annotation_layer_1, annotation_layer_2, annotation_layer_3,
            annotation_layer_4, annotation_layer_5, annotation_layer_6
        ]

        output_layers = []
        for i in range(6):
            if input_layers[i] is not None:
                # 左侧输入优先级最高，无论 json 中的可见性如何，只要连了线就强制使用
                output_layers.append(input_layers[i])
            else:
                # 没连线，查 json（提取出 tensor，如果不可见则为 empty_layer）
                output_layers.append(saved_custom_layers[i]["tensor"])
        
        # 合并层逻辑
        merged_layer = output_image.clone()
        if merged_layer.shape[-1] == 3:
            alpha_channel = torch.ones((merged_layer.shape[0], merged_layer.shape[1], merged_layer.shape[2], 1), dtype=torch.float32)
            merged_layer = torch.cat([merged_layer, alpha_channel], dim=-1)

        def merge_tensors(bottom, top):
            # 缩放至匹配大小（这里采用简单的直接合并，原插件默认不匹配直接报错或跳过。为了鲁棒性，如果有形状差异则略过合并）
            if bottom.shape[1] != top.shape[1] or bottom.shape[2] != top.shape[2]:
                print(f"[VPA Editor] Layer dimensions mismatch (Bottom: {bottom.shape[1]}x{bottom.shape[2]}, Top: {top.shape[1]}x{top.shape[2]}), skipping merge.")
                return bottom
                
            if top.shape[-1] == 4:
                alpha1 = top[..., 3:4]
                rgb1 = top[..., :3]
                
                alpha2 = bottom[..., 3:4]
                rgb2 = bottom[..., :3]
                
                out_alpha = alpha1 + alpha2 * (1 - alpha1)
                out_rgb = (rgb1 * alpha1 + rgb2 * alpha2 * (1 - alpha1)) / torch.clamp(out_alpha, min=1e-6)
                
                return torch.cat([out_rgb, out_alpha], dim=-1)
            else:
                return top
        
        for layer_tensor in output_layers:
            merged_layer = merge_tensors(merged_layer, layer_tensor)

        return (output_image, output_mask, edit_name, 
                output_layers[0], output_layers[1], output_layers[2], 
                output_layers[3], output_layers[4], output_layers[5], 
                merged_layer)

    @classmethod
    def IS_CHANGED(s, image, edit_name="", mask=None,
                   annotation_layer_1=None, annotation_layer_2=None, annotation_layer_3=None, 
                   annotation_layer_4=None, annotation_layer_5=None, annotation_layer_6=None):
        m = hashlib.sha256()
        
        file_prefix = edit_name if edit_name else "annotation"
        
        # Check layers file modification
        layers_json_path = os.path.join(VPA_DIR, f"{file_prefix}_layers.json")
        if os.path.exists(layers_json_path):
            m.update(str(os.path.getmtime(layers_json_path)).encode())
            
        return m.digest().hex() + str(edit_name)
