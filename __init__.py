import os
import folder_paths
from server import PromptServer
from aiohttp import web
import base64
from PIL import Image
import io

from .vpa_editor_node import VPAEditorLoadImage, VPA_DIR
from .vpa_editor_merge import VPAEditorMergeImage
from .vpa_editor_save import VPAImageSave

NODE_CLASS_MAPPINGS = {
    "VPAEditorLoadImage": VPAEditorLoadImage,
    "VPAEditorMergeImage": VPAEditorMergeImage,
    "VPAImageSave": VPAImageSave,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VPAEditorLoadImage": "VPA图像加载",
    "VPAEditorMergeImage": "VPA图像合并",
    "VPAImageSave": "VPA图像保存",
}

WEB_DIRECTORY = "./js"

SVG_BRUSHES_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "svg_brushes")

if not os.path.exists(SVG_BRUSHES_DIR):
    os.makedirs(SVG_BRUSHES_DIR)
    print(f"[VPA Editor] Created SVG brushes directory: {SVG_BRUSHES_DIR}")

@PromptServer.instance.routes.post("/vpa_editor/save_annotation")
async def save_annotation(request):
    try:
        data = await request.json()
        filename = data.get("filename", "annotation")
        image_data = data.get("image_data")
        preview_data = data.get("preview_data")
        
        if not image_data:
            return web.json_response({"success": False, "error": "No image data provided"})
        
        if not os.path.exists(VPA_DIR):
            os.makedirs(VPA_DIR)
        
        # Save annotation
        if "," in image_data:
            image_data = image_data.split(",")[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        annotation_path = os.path.join(VPA_DIR, f"{filename}_annotation.png")
        image.save(annotation_path, "PNG")
        
        # Save preview image
        if preview_data:
            if "," in preview_data:
                preview_data = preview_data.split(",")[1]
            
            preview_bytes = base64.b64decode(preview_data)
            preview_image = Image.open(io.BytesIO(preview_bytes))
            preview_path = os.path.join(VPA_DIR, f"{filename}_preview.png")
            preview_image.save(preview_path, "PNG")
            print(f"[VPA Editor] Saved preview to: {preview_path}")
        
        print(f"[VPA Editor] Saved annotation to: {annotation_path}")
        
        return web.json_response({"success": True, "annotation_path": annotation_path})
    except Exception as e:
        print(f"[VPA Editor] Error saving annotation: {e}")
        return web.json_response({"success": False, "error": str(e)})

@PromptServer.instance.routes.get("/vpa_editor/list_svgs")
async def list_svgs(request):
    try:
        svg_files = []
        if os.path.exists(SVG_BRUSHES_DIR):
            for filename in os.listdir(SVG_BRUSHES_DIR):
                if filename.lower().endswith(".svg"):
                    svg_files.append(filename)
        return web.json_response({"success": True, "svgs": svg_files})
    except Exception as e:
        print(f"[VPA Editor] Error listing SVGs: {e}")
        return web.json_response({"success": False, "error": str(e)})

@PromptServer.instance.routes.get("/vpa_editor/get_svg")
async def get_svg(request):
    try:
        filename = request.query.get("filename")
        if not filename:
            return web.json_response({"success": False, "error": "No filename provided"})
        
        filepath = os.path.join(SVG_BRUSHES_DIR, filename)
        if not os.path.exists(filepath):
            return web.json_response({"success": False, "error": "File not found"})
        
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        
        return web.json_response({"success": True, "filename": filename, "content": content})
    except Exception as e:
        print(f"[VPA Editor] Error getting SVG: {e}")
        return web.json_response({"success": False, "error": str(e)})

@PromptServer.instance.routes.post("/vpa_editor/save_layers")
async def save_layers(request):
    try:
        data = await request.json()
        filename = data.get("filename", "annotation")
        layers_data = data.get("layers")
        
        if not layers_data:
            return web.json_response({"success": False, "error": "No layers data provided"})
        
        if not os.path.exists(VPA_DIR):
            os.makedirs(VPA_DIR)
        
        save_path = os.path.join(VPA_DIR, f"{filename}_layers.json")
        
        import json
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(layers_data, f, ensure_ascii=False)
        
        print(f"[VPA Editor] Saved layers to: {save_path}")
        
        return web.json_response({"success": True, "path": save_path})
    except Exception as e:
        print(f"[VPA Editor] Error saving layers: {e}")
        return web.json_response({"success": False, "error": str(e)})

@PromptServer.instance.routes.get("/vpa_editor/load_layers")
async def load_layers(request):
    try:
        filename = request.query.get("filename")
        if not filename:
            return web.json_response({"success": False, "error": "No filename provided"})
        
        load_path = os.path.join(VPA_DIR, f"{filename}_layers.json")
        
        if not os.path.exists(load_path):
            return web.json_response({"success": False, "error": "Layers file not found"})
        
        import json
        with open(load_path, "r", encoding="utf-8") as f:
            layers_data = json.load(f)
        
        return web.json_response({"success": True, "layers": layers_data})
    except Exception as e:
        print(f"[VPA Editor] Error loading layers: {e}")
        return web.json_response({"success": False, "error": str(e)})

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
