import torch


class VPAEditorMergeImage:
    """
    VPA图像合并节点
    - 输入2张图像：image1（上面）、image2（下面）
    - 合并前提：2张图像尺寸必须相同，否则报错
    - 输出：合并后的图像（image1在image2上面）
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image1": ("IMAGE",),
                "image2": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("合并图像",)
    FUNCTION = "merge_images"
    CATEGORY = "VPAEditor"

    def merge_images(self, image1, image2):
        if image1.shape[1] != image2.shape[1] or image1.shape[2] != image2.shape[2]:
            raise ValueError(
                f"图像尺寸不匹配！\nimage1: {image1.shape[1]}x{image1.shape[2]}\nimage2: {image2.shape[1]}x{image2.shape[2]}"
            )
        
        result = image2.clone()
        
        if image1.shape[-1] == 4:
            alpha1 = image1[..., 3:4]
            rgb1 = image1[..., :3]
            
            if result.shape[-1] == 4:
                alpha2 = result[..., 3:4]
                rgb2 = result[..., :3]
                
                out_alpha = alpha1 + alpha2 * (1 - alpha1)
                out_rgb = (rgb1 * alpha1 + rgb2 * alpha2 * (1 - alpha1)) / torch.clamp(out_alpha, min=1e-6)
                
                result = torch.cat([out_rgb, out_alpha], dim=-1)
            else:
                result[..., :3] = rgb1 * alpha1 + result[..., :3] * (1 - alpha1)
        else:
            result = image1
        
        return (result,)
