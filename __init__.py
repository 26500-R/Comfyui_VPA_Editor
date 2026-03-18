import os
import folder_paths
from server import PromptServer
from aiohttp import web
import base64
from PIL import Image
import io
import hashlib

from .vpa_editor_node import VPAEditorLoadImage, VPA_DIR
from .vpa_editor_merge import VPAEditorMergeImage
from .vpa_editor_save import VPAImageSave

THUMBNAILS_DIR = os.path.join(VPA_DIR, "thumbnails")
if not os.path.exists(THUMBNAILS_DIR):
    os.makedirs(THUMBNAILS_DIR)
    print(f"[VPA Editor] Created thumbnails directory: {THUMBNAILS_DIR}")

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

def generate_thumbnail(image_path, max_size=256, cache_key=None):
    """
    Generate thumbnail and cache it to disk.
    Returns the thumbnail path if successful, None otherwise.
    """
    try:
        if not os.path.exists(image_path):
            return None
        
        if cache_key is None:
            cache_key = hashlib.md5(f"{image_path}_{max_size}_{os.path.getmtime(image_path)}".encode()).hexdigest()
        
        thumb_filename = f"{cache_key}.png"
        thumb_path = os.path.join(THUMBNAILS_DIR, thumb_filename)
        
        if os.path.exists(thumb_path):
            return thumb_path
        
        img = Image.open(image_path)
        
        if img.mode == 'RGBA':
            pass
        elif img.mode == 'P':
            img = img.convert('RGBA')
        else:
            img = img.convert('RGB')
        
        width, height = img.size
        if max(width, height) > max_size:
            ratio = max_size / max(width, height)
            new_width = int(width * ratio)
            new_height = int(height * ratio)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        img.save(thumb_path, "PNG", optimize=True)
        print(f"[VPA Editor] Generated thumbnail: {thumb_path}")
        
        return thumb_path
    except Exception as e:
        print(f"[VPA Editor] Error generating thumbnail: {e}")
        return None

def generate_thumbnail_from_base64(image_data, max_size=256, filename_prefix="preview"):
    """
    Generate thumbnail from base64 image data.
    Returns the thumbnail path if successful, None otherwise.
    """
    try:
        if "," in image_data:
            image_data = image_data.split(",")[1]
        
        image_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(image_bytes))
        
        if img.mode == 'RGBA':
            pass
        elif img.mode == 'P':
            img = img.convert('RGBA')
        else:
            img = img.convert('RGB')
        
        width, height = img.size
        if max(width, height) > max_size:
            ratio = max_size / max(width, height)
            new_width = int(width * ratio)
            new_height = int(height * ratio)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        thumb_filename = f"{filename_prefix}_thumb.png"
        thumb_path = os.path.join(THUMBNAILS_DIR, thumb_filename)
        img.save(thumb_path, "PNG", optimize=True)
        print(f"[VPA Editor] Generated thumbnail from base64: {thumb_path}")
        
        return thumb_path
    except Exception as e:
        print(f"[VPA Editor] Error generating thumbnail from base64: {e}")
        return None

@PromptServer.instance.routes.get("/vpa_editor/thumbnail")
async def get_thumbnail(request):
    """
    Get or generate thumbnail for an image.
    Parameters:
    - filename: Original image filename
    - type: input/output (default: input)
    - size: Thumbnail max size (default: 256)
    - subfolder: Subfolder (optional)
    """
    try:
        filename = request.query.get("filename")
        if not filename:
            return web.json_response({"success": False, "error": "No filename provided"})
        
        img_type = request.query.get("type", "input")
        size = int(request.query.get("size", 256))
        subfolder = request.query.get("subfolder", "")
        
        if img_type == "input":
            base_dir = folder_paths.get_input_directory()
        elif img_type == "output":
            base_dir = folder_paths.get_output_directory()
        else:
            return web.json_response({"success": False, "error": f"Invalid type: {img_type}"})
        
        if subfolder:
            image_path = os.path.join(base_dir, subfolder, filename)
        else:
            image_path = os.path.join(base_dir, filename)
        
        if not os.path.exists(image_path):
            return web.json_response({"success": False, "error": f"Image not found: {image_path}"})
        
        cache_key = hashlib.md5(f"{image_path}_{size}_{os.path.getmtime(image_path)}".encode()).hexdigest()
        thumb_path = generate_thumbnail(image_path, size, cache_key)
        
        if not thumb_path or not os.path.exists(thumb_path):
            return web.json_response({"success": False, "error": "Failed to generate thumbnail"})
        
        with open(thumb_path, "rb") as f:
            thumb_data = f.read()
        
        return web.Response(
            body=thumb_data,
            content_type="image/png",
            headers={
                "Cache-Control": "public, max-age=86400",
                "X-Thumbnail-Path": thumb_path
            }
        )
    except Exception as e:
        print(f"[VPA Editor] Error getting thumbnail: {e}")
        return web.json_response({"success": False, "error": str(e)})

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
        
        if "," in image_data:
            image_data = image_data.split(",")[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        annotation_path = os.path.join(VPA_DIR, f"{filename}_annotation.png")
        image.save(annotation_path, "PNG")
        
        if preview_data:
            if "," in preview_data:
                preview_data_clean = preview_data.split(",")[1]
            else:
                preview_data_clean = preview_data
            
            preview_bytes = base64.b64decode(preview_data_clean)
            preview_image = Image.open(io.BytesIO(preview_bytes))
            preview_path = os.path.join(VPA_DIR, f"{filename}_preview.png")
            preview_image.save(preview_path, "PNG")
            print(f"[VPA Editor] Saved preview to: {preview_path}")
            
            thumb_path = generate_thumbnail_from_base64(
                preview_data_clean if "," not in preview_data else preview_data,
                max_size=256,
                filename_prefix=f"{filename}_preview"
            )
            if thumb_path:
                print(f"[VPA Editor] Saved preview thumbnail to: {thumb_path}")
        
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
