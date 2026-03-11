import os
import datetime
import random
import string
import json
import numpy as np
from PIL import Image
import folder_paths


class VPAImageSave:
    """
    VPA图像保存节点
    - 去掉元数据（无法拖入ComfyUI复现工作流）
    - 可自定义保存路径
    - 命名规则：前缀_日期时间_随机5字符_名称文本.png
    """

    def __init__(self):
        self.type = "output"
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "save_path": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "保存路径（留空则保存到output目录）",
                    },
                ),
                "filename_pattern": (
                    "STRING",
                    {
                        "default": "{name}_{time}_{random}",
                        "multiline": False,
                        "placeholder": "支持: {name}, {time}, {date}, {random}, {index}",
                    },
                ),
                "image_format": (["png", "jpg", "webp"],),
                "jpg_quality": (
                    "INT",
                    {"default": 95, "min": 1, "max": 100, "step": 1},
                ),
            },
            "optional": {
                "name_text": (
                    "STRING",
                    {"forceInput": True},
                ),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "VPAEditor"

    def save_images(
        self,
        images,
        save_path="",
        filename_pattern="{name}_{time}_{random}",
        image_format="png",
        jpg_quality=95,
        name_text=None,
    ):
        # 确定保存目录
        is_abs = False  # ✅ Fix2：提前初始化，避免 save_path 为空时 is_abs 未定义
        if save_path is None or save_path.strip() == "":
            output_dir = folder_paths.get_output_directory()
            full_output_dir = output_dir  # ✅ Fix1：补全 full_output_dir 赋值
        else:
            output_dir = save_path.strip()
            # 规范化路径，处理 Windows 的反斜杠
            output_dir = os.path.normpath(output_dir)
            
            # 判断是否是绝对路径
            is_abs = os.path.isabs(output_dir)
            if not is_abs:
                # 相对路径，相对于 ComfyUI 输出目录
                full_output_dir = os.path.join(
                    folder_paths.get_output_directory(), output_dir
                )
            else:
                full_output_dir = output_dir

        # 确保目录存在
        os.makedirs(full_output_dir, exist_ok=True)

        results = []
        
        # 准备基础占位符数据
        now = datetime.datetime.now()
        base_format_dict = {
            "time": now.strftime("%Y%m%d%H%M%S"),
            "date": now.strftime("%Y%m%d"),
            "name": name_text if name_text else "untitled",
        }
        
        for idx, image in enumerate(images):
            # tensor -> numpy -> PIL
            img_np = image.cpu().numpy()
            img_np = np.clip(img_np * 255.0, 0, 255).astype(np.uint8)
            pil_image = Image.fromarray(img_np)

            # 为每一张图生成独立的占位符数据
            format_dict = base_format_dict.copy()
            format_dict["random"] = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
            
            if len(images) > 1:
                format_dict["index"] = f"{idx + 1:03d}"
            else:
                # 只有一张图时，如果不想要 index，可以在替换时处理，或者默认为 001
                format_dict["index"] = "001"
                
            # 解析模板
            pattern = filename_pattern if filename_pattern else "{name}_{time}_{random}"
            
            # 使用安全替换，防止有些占位符没填导致报错
            try:
                filename_base = pattern.format(**format_dict)
            except KeyError as e:
                # 如果用户填了不支持的变量，就回退到安全模式
                print(f"[VPA图像保存] 警告：不支持的占位符 {e}，回退到默认命名格式")
                filename_base = f"{format_dict['name']}_{format_dict['time']}_{format_dict['random']}"
                
            # 清理文件名中的非法字符（如果是路径分隔符 / 或 \ 则允许，用来建子文件夹）
            # 使用特定的字符集，避开末尾反斜杠转义问题
            valid_chars = "-_.() /\\ " + string.ascii_letters + string.digits
            filename_base = "".join(c for c in filename_base if c in valid_chars)
            
            # 兼容：如果模板完全没用 index，但传入了多张图，强制在末尾加上序号
            if len(images) > 1 and "{index}" not in pattern:
                filename_base = f"{filename_base}_{format_dict['index']}"

            # 如果用户在命名模板里写了类似 `folder/{name}` 的格式，那么它会在指定的输出目录下再建一层子目录
            file_dir = os.path.dirname(filename_base)
            if file_dir:
                os.makedirs(os.path.join(full_output_dir, file_dir), exist_ok=True)
                
            # 根据格式选择扩展名
            if image_format == "jpg":
                ext = ".jpg"
            elif image_format == "webp":
                ext = ".webp"
            else:
                ext = ".png"

            filename = filename_base + ext
            filepath = os.path.join(full_output_dir, filename)

            # 保存图片 - 不写入任何元数据！
            if image_format == "png":
                # 不传 pnginfo，这样就没有元数据
                pil_image.save(filepath, format="PNG", compress_level=self.compress_level)
            elif image_format == "jpg":
                # JPEG 本身不存 ComfyUI 元数据
                if pil_image.mode == "RGBA":
                    pil_image = pil_image.convert("RGB")
                pil_image.save(filepath, format="JPEG", quality=jpg_quality)
            elif image_format == "webp":
                pil_image.save(filepath, format="WEBP", quality=jpg_quality)
                
            print(f"[VPA图像保存] 已保存: {filepath}")

            # 处理预览返回结果
            if save_path is None or save_path.strip() == "":
                # 默认输出目录
                results.append({"filename": filename, "subfolder": "", "type": self.type})
            else:
                if not is_abs:
                    # 相对路径，将反斜杠替换为斜杠供前端使用
                    subfolder = output_dir.replace(os.sep, "/")
                    results.append({"filename": filename, "subfolder": subfolder, "type": self.type})
                else:
                    # 绝对路径，前端无法直接读取外部文件，因此在 temp 目录存一份用于预览
                    temp_dir = folder_paths.get_temp_directory()
                    os.makedirs(temp_dir, exist_ok=True)
                    temp_filepath = os.path.join(temp_dir, filename)
                    
                    if image_format == "png":
                        pil_image.save(temp_filepath, format="PNG", compress_level=self.compress_level)
                    elif image_format == "jpg":
                        pil_image.save(temp_filepath, format="JPEG", quality=jpg_quality)
                    elif image_format == "webp":
                        pil_image.save(temp_filepath, format="WEBP", quality=jpg_quality)
                        
                    results.append({"filename": filename, "subfolder": "", "type": "temp"})

        return {"ui": {"images": results}}
