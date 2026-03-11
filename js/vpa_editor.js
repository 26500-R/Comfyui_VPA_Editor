import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[VPA Editor] Loading extension...");

class VPAEditorWindow {
    constructor(node) {
        this.node = node;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.windowElement = null;
        
        this.baseImage = null;
        this.baseImageWidth = 0;
        this.baseImageHeight = 0;
        
        this.scaleFinal = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        
        this.layers = [];
        this.maxCustomLayers = 6;
        
        this.currentLayerIndex = -1;
        
        this.brush = {
            shape: 'circle',
            size: 20,
            opacity: 1,
            spacing: 1,
            color: '#ff0000'
        };
        
        this.svgBrushes = [];
        this.svgBrushCache = new Map();
        
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;
        
        this.isDrawing = false;
        this.lastDrawPos = null;
        
        this.canvases = {
            container: null,
            display: null,
            baseLayer: null,
            customLayers: []
        };
        
        this.createWindow();
        this.loadImageFromNode();
        this.loadSVGBrushes();
    }

    createWindow() {
        this.windowElement = document.createElement("div");
        this.windowElement.className = "vpa-editor-window";
        this.windowElement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 1300px;
            height: 750px;
            background-color: var(--comfy-menu-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        this.windowElement.appendChild(this.createTitleBar());
        this.windowElement.appendChild(this.createMainContent());

        document.body.appendChild(this.windowElement);
        this.setupDragging();
        this.setupResizeListener();
    }

    createTitleBar() {
        const titleBar = document.createElement("div");
        titleBar.className = "vpa-editor-titlebar";
        titleBar.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 16px;
            background-color: var(--comfy-input-bg);
            border-bottom: 1px solid var(--border-color);
            cursor: move;
            user-select: none;
        `;

        const title = document.createElement("span");
        title.textContent = "Visual Prompt Anchor @26500 ";
        title.style.cssText = `
            color: var(--input-text);
            font-weight: bold;
            font-size: 14px;
        `;

        const closeButton = document.createElement("button");
        closeButton.textContent = "×";
        closeButton.className = "vpa-editor-close-btn";
        closeButton.style.cssText = `
            background: none;
            border: none;
            color: var(--input-text);
            font-size: 24px;
            cursor: pointer;
            padding: 0 8px;
            line-height: 1;
        `;
        closeButton.onmouseover = () => {
            closeButton.style.color = "var(--error-text)";
        };
        closeButton.onmouseout = () => {
            closeButton.style.color = "var(--input-text)";
        };
        closeButton.onclick = () => this.close();

        titleBar.appendChild(title);
        titleBar.appendChild(closeButton);

        return titleBar;
    }

    createMainContent() {
        const mainContent = document.createElement("div");
        mainContent.className = "vpa-editor-main";
        mainContent.style.cssText = `
            display: flex;
            flex: 1;
            overflow: hidden;
            position: relative;
            padding-bottom: 60px;
        `;

        mainContent.appendChild(this.createImagePreviewPanel());
        mainContent.appendChild(this.createToolConfigPanel());
        mainContent.appendChild(this.createLayerManagerPanel());
        mainContent.appendChild(this.createBottomButtons());

        return mainContent;
    }

    createImagePreviewPanel() {
        const panel = document.createElement("div");
        panel.className = "vpa-editor-panel vpa-editor-image-panel";
        panel.style.cssText = `
            flex: 2.5;
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            background-color: var(--comfy-menu-bg);
        `;

        const header = document.createElement("div");
        header.className = "vpa-editor-panel-header";
        header.style.cssText = `
            padding: 10px 12px;
            background-color: var(--comfy-input-bg);
            border-bottom: 1px solid var(--border-color);
            font-weight: bold;
            color: var(--input-text);
            font-size: 12px;
        `;
        header.textContent = "图像预览";

        const content = document.createElement("div");
        content.className = "vpa-editor-panel-content";
        content.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background-color: rgba(0, 0, 0, 0.1);
        `;

        const canvasContainer = document.createElement("div");
        canvasContainer.id = "canvas-container";
        canvasContainer.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 20px 20px;
        `;
        this.canvases.container = canvasContainer;

        const displayCanvas = document.createElement("canvas");
        displayCanvas.id = "display-canvas";
        displayCanvas.style.cssText = `
            position: absolute;
            cursor: none;
        `;
        this.canvases.display = displayCanvas;
        canvasContainer.appendChild(displayCanvas);

        const cursorCanvas = document.createElement("canvas");
        cursorCanvas.id = "cursor-canvas";
        cursorCanvas.style.cssText = `
            position: absolute;
            pointer-events: none;
        `;
        this.canvases.cursor = cursorCanvas;
        canvasContainer.appendChild(cursorCanvas);

        const baseLayerCanvas = document.createElement("canvas");
        baseLayerCanvas.style.display = "none";
        this.canvases.baseLayer = baseLayerCanvas;

        const sizeInfo = document.createElement("div");
        sizeInfo.id = "size-info";
        sizeInfo.style.cssText = `
            padding: 8px 12px;
            background-color: var(--comfy-input-bg);
            border-top: 1px solid var(--border-color);
            color: var(--input-text);
            font-size: 12px;
            text-align: center;
        `;
        sizeInfo.textContent = "原始尺寸：--×-- px";

        content.appendChild(canvasContainer);
        content.appendChild(sizeInfo);

        panel.appendChild(header);
        panel.appendChild(content);

        this.setupCanvasEvents(displayCanvas);

        return panel;
    }

    createToolConfigPanel() {
        const panel = document.createElement("div");
        panel.className = "vpa-editor-panel vpa-editor-tools-panel";
        panel.style.cssText = `
            flex: 1;
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            background-color: var(--comfy-menu-bg);
        `;

        const header = document.createElement("div");
        header.className = "vpa-editor-panel-header";
        header.style.cssText = `
            padding: 10px 12px;
            background-color: var(--comfy-input-bg);
            border-bottom: 1px solid var(--border-color);
            font-weight: bold;
            color: var(--input-text);
            font-size: 12px;
        `;
        header.textContent = "工具配置";

        const content = document.createElement("div");
        content.className = "vpa-editor-panel-content";
        content.style.cssText = `
            flex: 1;
            padding: 12px;
            overflow-y: auto;
        `;

        content.appendChild(this.createBrushLibrary());
        content.appendChild(this.createBrushSizeControl());
        content.appendChild(this.createOpacityControl());
        content.appendChild(this.createSpacingControl());
        content.appendChild(this.createColorPicker());

        panel.appendChild(header);
        panel.appendChild(content);

        return panel;
    }

    createBrushLibrary() {
        const container = document.createElement("div");
        container.style.cssText = `
            margin-bottom: 16px;
        `;

        const label = document.createElement("div");
        label.style.cssText = `
            color: var(--input-text);
            font-size: 12px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const labelText = document.createElement("span");
        labelText.textContent = "图案库";
        label.appendChild(labelText);

        const refreshBtn = document.createElement("button");
        refreshBtn.textContent = "刷新";
        refreshBtn.style.cssText = `
            padding: 2px 8px;
            font-size: 10px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            color: var(--input-text);
            cursor: pointer;
        `;
        refreshBtn.onclick = () => this.loadSVGBrushes();
        label.appendChild(refreshBtn);

        const shapesContainer = document.createElement("div");
        shapesContainer.id = "brush-library";
        shapesContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            max-height: 250px;
            overflow-y: auto;
            padding-right: 4px;
        `;

        container.appendChild(label);
        container.appendChild(shapesContainer);

        return container;
    }

    renderBrushLibrary() {
        const container = document.getElementById("brush-library");
        if (!container) return;
        
        container.innerHTML = '';

        const presets = [
            { id: 'circle', name: '圆形', type: 'preset' },
            { id: 'square', name: '方形', type: 'preset' },
            { id: 'triangle', name: '三角形', type: 'preset' }
        ];

        presets.forEach(preset => {
            const btn = this.createBrushButton(preset.id, preset.name, preset.type, preset.id === this.brush.shape);
            container.appendChild(btn);
        });

        this.svgBrushes.forEach((svg, index) => {
            const btn = this.createBrushButton(svg.id, svg.name, 'svg', this.brush.shape === svg.id);
            container.appendChild(btn);
        });
    }

    createBrushButton(id, name, type, selected) {
        const btn = document.createElement("button");
        btn.style.cssText = `
            height: ${type === 'preset' ? '70px' : '60px'};
            padding: 8px;
            background-color: ${selected ? 'var(--comfy-input-bg)' : 'var(--comfy-menu-bg)'};
            border: 2px solid ${selected ? '#4ade80' : 'var(--border-color)'};
            border-radius: 4px;
            color: var(--input-text);
            font-size: 10px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            overflow: hidden;
        `;
        
        if (type === 'preset') {
            const preview = document.createElement("div");
            if (id === 'triangle') {
                preview.style.cssText = `
                    width: 0;
                    height: 0;
                    border-left: 12px solid transparent;
                    border-right: 12px solid transparent;
                    border-bottom: 24px solid var(--input-text);
                `;
            } else {
                preview.style.cssText = `
                    width: 24px;
                    height: 24px;
                    border-radius: ${id === 'circle' ? '50%' : '2px'};
                    background-color: var(--input-text);
                `;
            }
            btn.appendChild(preview);
        } else if (type === 'svg') {
            const svgData = this.svgBrushCache.get(id);
            if (svgData) {
                const preview = document.createElement("div");
                preview.style.cssText = `
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    flex-shrink: 0;
                `;
                
                let svgContent = svgData.content;
                
                svgContent = svgContent.replace(/<svg([^>]*)>/i, (match, attrs) => {
                    let viewBox = '';
                    const viewBoxMatch = attrs.match(/viewBox="([^"]*)"/i);
                    if (viewBoxMatch) {
                        viewBox = viewBoxMatch[1];
                    }
                    if (!viewBox) {
                        viewBox = '0 0 100 100';
                    }
                    return `<svg width="40" height="40" viewBox="${viewBox}" fill="var(--input-text)" style="max-width: 100%; max-height: 100%;">`;
                });
                
                preview.innerHTML = svgContent;
                btn.appendChild(preview);
            }
        }

        if (type === 'preset') {
            const nameSpan = document.createElement("span");
            nameSpan.style.cssText = `
                font-size: 9px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
            `;
            nameSpan.textContent = name;
            btn.appendChild(nameSpan);
        }

        btn.dataset.brushId = id;
        btn.dataset.brushType = type;

        btn.onclick = () => {
            this.brush.shape = id;
            this.renderBrushLibrary();
            this.hideCursor();
        };

        return btn;
    }

    async loadSVGBrushes() {
        this.svgBrushes = [];
        this.svgBrushCache.clear();

        try {
            console.log('[VPA Editor] Loading SVG list...');
            const response = await api.fetchApi('/vpa_editor/list_svgs');
            const result = await response.json();

            if (result.success && result.svgs) {
                for (const filename of result.svgs) {
                    const name = filename.replace('.svg', '');
                    const id = `svg_${name}`;
                    
                    try {
                        const svgResponse = await api.fetchApi(`/vpa_editor/get_svg?filename=${encodeURIComponent(filename)}`);
                        const svgResult = await svgResponse.json();
                        
                        if (svgResult.success && svgResult.content) {
                            // 预处理 SVG 内容：移除硬编码的 fill 属性，确保外部可以修改颜色
                            let processedContent = svgResult.content;
                            
                            // 移除所有的 fill 属性，无论是内联在标签上的还是在 style 属性里的
                            processedContent = processedContent.replace(/fill="[^"]*"/ig, '');
                            processedContent = processedContent.replace(/fill:([^;"]+)(;?)/ig, '');
                            
                            this.svgBrushes.push({ id, name, filename });
                            this.svgBrushCache.set(id, {
                                name,
                                filename,
                                content: processedContent
                            });
                        }
                    } catch (e) {
                        console.error(`[VPA Editor] Error loading SVG ${filename}:`, e);
                    }
                }
                console.log('[VPA Editor] Loaded', this.svgBrushes.length, 'SVG brushes');
            }
        } catch (e) {
            console.error('[VPA Editor] Error loading SVG list:', e);
        }

        this.renderBrushLibrary();
    }

    createBrushSizeControl() {
        return this.createSliderControl('笔刷大小', 'size', 1, 1000, 20);
    }

    createOpacityControl() {
        return this.createSliderControl('不透明度', 'opacity', 0, 1, 1, 0.01);
    }

    createSpacingControl() {
        return this.createSliderControl('间距', 'spacing', 0.1, 10, 1, 0.1);
    }

    createSliderControl(labelText, property, min, max, defaultValue, step = 1) {
        const container = document.createElement("div");
        container.style.cssText = `
            margin-bottom: 16px;
        `;

        const labelRow = document.createElement("div");
        labelRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        `;

        const label = document.createElement("div");
        label.style.cssText = `
            color: var(--input-text);
            font-size: 12px;
        `;
        label.textContent = labelText;

        const valueInput = document.createElement("input");
        valueInput.type = 'number';
        valueInput.min = min;
        valueInput.max = max;
        valueInput.step = step;
        valueInput.value = defaultValue;
        valueInput.style.cssText = `
            width: 60px;
            padding: 4px 8px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
        `;

        const slider = document.createElement("input");
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = defaultValue;
        slider.style.cssText = `
            width: 100%;
        `;

        const updateValue = (val) => {
            val = Math.max(min, Math.min(max, parseFloat(val)));
            this.brush[property] = val;
            valueInput.value = val;
            slider.value = val;
            this.hideCursor();
        };

        slider.oninput = (e) => updateValue(e.target.value);
        valueInput.onchange = (e) => updateValue(e.target.value);

        labelRow.appendChild(label);
        labelRow.appendChild(valueInput);
        container.appendChild(labelRow);
        container.appendChild(slider);

        return container;
    }

    createColorPicker() {
        const container = document.createElement("div");
        container.style.cssText = `
            margin-bottom: 16px;
        `;

        const label = document.createElement("div");
        label.style.cssText = `
            color: var(--input-text);
            font-size: 12px;
            margin-bottom: 8px;
        `;
        label.textContent = "笔刷颜色";

        const colorsContainer = document.createElement("div");
        colorsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 8px;
        `;

        const defaultColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        
        if (!this.colorPalette) {
            this.colorPalette = [...defaultColors];
        }

        this.colorPalette.forEach((color, index) => {
            const colorBtn = document.createElement("div");
            colorBtn.style.cssText = `
                width: 100%;
                padding-top: 100%;
                position: relative;
                cursor: pointer;
                border-radius: 4px;
                background-color: ${color};
                border: 3px solid ${this.brush.color === color ? '#ffffff' : 'var(--border-color)'};
                box-sizing: border-box;
            `;

            colorBtn.onclick = () => {
                this.brush.color = color;
                this.hideCursor();
                this.renderColorPalette();
            };

            const colorInput = document.createElement("input");
            colorInput.type = 'color';
            colorInput.value = color;
            colorInput.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                opacity: 0;
                cursor: pointer;
            `;

            colorInput.onchange = (e) => {
                const newColor = e.target.value;
                this.colorPalette[index] = newColor;
                this.brush.color = newColor;
                this.hideCursor();
                this.renderColorPalette();
            };

            colorBtn.appendChild(colorInput);
            colorsContainer.appendChild(colorBtn);
        });

        this.colorsContainer = colorsContainer;
        container.appendChild(label);
        container.appendChild(colorsContainer);

        return container;
    }

    renderColorPalette() {
        if (!this.colorsContainer) return;
        
        const colorBtns = this.colorsContainer.children;
        for (let i = 0; i < colorBtns.length; i++) {
            const btn = colorBtns[i];
            const color = this.colorPalette[i];
            btn.style.backgroundColor = color;
            btn.style.borderColor = this.brush.color === color ? '#ffffff' : 'var(--border-color)';
        }
    }

    createLayerManagerPanel() {
        const panel = document.createElement("div");
        panel.className = "vpa-editor-panel vpa-editor-layers-panel";
        panel.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            background-color: var(--comfy-menu-bg);
        `;

        const header = document.createElement("div");
        header.className = "vpa-editor-panel-header";
        header.style.cssText = `
            padding: 10px 12px;
            background-color: var(--comfy-input-bg);
            border-bottom: 1px solid var(--border-color);
            font-weight: bold;
            color: var(--input-text);
            font-size: 12px;
        `;
        header.textContent = "图层管理";

        const content = document.createElement("div");
        content.className = "vpa-editor-panel-content";
        content.id = "layer-list-container";
        content.style.cssText = `
            flex: 1;
            padding: 12px;
            overflow-y: auto;
        `;

        const newLayerBtn = document.createElement("button");
        newLayerBtn.textContent = "新建图层";
        newLayerBtn.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            margin-bottom: 12px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        newLayerBtn.onclick = () => this.createNewLayer();
        content.appendChild(newLayerBtn);

        const layerList = document.createElement("div");
        layerList.id = "layer-list";
        layerList.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;
        content.appendChild(layerList);

        panel.appendChild(header);
        panel.appendChild(content);

        return panel;
    }

    createBottomButtons() {
        const container = document.createElement("div");
        container.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 12px;
            background-color: var(--comfy-menu-bg);
            border-top: 1px solid var(--border-color);
            display: flex;
            gap: 12px;
            justify-content: space-between;
        `;

        const leftContainer = document.createElement("div");
        leftContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        const undoBtn = document.createElement("button");
        undoBtn.textContent = "撤销";
        undoBtn.id = "undo-btn";
        undoBtn.style.cssText = `
            padding: 8px 16px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        undoBtn.onclick = () => this.undo();
        undoBtn.disabled = true;
        leftContainer.appendChild(undoBtn);

        const redoBtn = document.createElement("button");
        redoBtn.textContent = "重做";
        redoBtn.id = "redo-btn";
        redoBtn.style.cssText = `
            padding: 8px 16px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        redoBtn.onclick = () => this.redo();
        redoBtn.disabled = true;
        leftContainer.appendChild(redoBtn);

        const rightContainer = document.createElement("div");
        rightContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "取消";
        cancelBtn.style.cssText = `
            padding: 8px 24px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        cancelBtn.onclick = () => this.close();
        rightContainer.appendChild(cancelBtn);

        const applyBtn = document.createElement("button");
        applyBtn.textContent = "应用";
        applyBtn.style.cssText = `
            padding: 8px 24px;
            background-color: var(--comfy-input-bg);
            border: 1px solid var(--fg-color);
            border-radius: 4px;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        applyBtn.onclick = () => this.applyAndExport();
        rightContainer.appendChild(applyBtn);

        container.appendChild(leftContainer);
        container.appendChild(rightContainer);

        return container;
    }

    setupCanvasEvents(canvas) {
        canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        canvas.addEventListener('mouseleave', (e) => this.onCanvasMouseLeave(e));
        canvas.addEventListener('mouseenter', (e) => this.onCanvasMouseEnter(e));
    }

    onCanvasMouseDown(e) {
        if (this.currentLayerIndex < 0) {
            console.log('[Annotation Editor] No layer selected');
            return;
        }
        
        this.saveToHistory();
        
        this.isDrawing = true;
        const pos = this.getCanvasCoordinates(e);
        this.lastDrawPos = pos;
        
        if (this.brush.shape.startsWith('svg_')) {
            this.drawAtPosition(pos);
            this.isDrawing = false;
        } else {
            this.drawAtPosition(pos);
        }
    }

    onCanvasMouseMove(e) {
        const pos = this.getCanvasCoordinates(e);
        this.renderCursor(e, pos);
        
        if (!this.isDrawing || this.currentLayerIndex < 0) return;
        
        if (!this.brush.shape.startsWith('svg_')) {
            this.drawLineToPosition(pos);
        }
    }

    onCanvasMouseUp(e) {
        this.isDrawing = false;
        this.lastDrawPos = null;
        this.renderDisplay();
    }

    onCanvasMouseLeave(e) {
        this.hideCursor();
    }

    onCanvasMouseEnter(e) {
        const pos = this.getCanvasCoordinates(e);
        this.renderCursor(e, pos);
    }

    saveToHistory() {
        const layer = this.layers[this.currentLayerIndex];
        if (!layer) return;
        
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        const snapshot = layer.canvas.toDataURL();
        this.history.push({
            layerIndex: this.currentLayerIndex,
            imageData: snapshot
        });
        
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex = this.history.length - 1;
        }
        
        this.updateHistoryButtons();
    }

    undo() {
        if (this.historyIndex < 0) return;
        
        const state = this.history[this.historyIndex];
        if (!state) return;
        
        const layer = this.layers[state.layerIndex];
        if (!layer) return;
        
        const img = new Image();
        img.onload = () => {
            const ctx = layer.canvas.getContext('2d');
            ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            ctx.drawImage(img, 0, 0);
            this.renderDisplay();
        };
        img.src = state.imageData;
        
        this.historyIndex--;
        this.updateHistoryButtons();
    }

    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        
        this.historyIndex++;
        const state = this.history[this.historyIndex];
        if (!state) return;
        
        const layer = this.layers[state.layerIndex];
        if (!layer) return;
        
        const img = new Image();
        img.onload = () => {
            const ctx = layer.canvas.getContext('2d');
            ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            ctx.drawImage(img, 0, 0);
            this.renderDisplay();
        };
        img.src = state.imageData;
        
        this.updateHistoryButtons();
    }

    updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) {
            undoBtn.disabled = this.historyIndex < 0;
        }
        if (redoBtn) {
            redoBtn.disabled = this.historyIndex >= this.history.length - 1;
        }
    }

    renderCursor(e, pos) {
        const cursorCanvas = this.canvases.cursor;
        if (!cursorCanvas) return;
        
        const rect = this.canvases.display.getBoundingClientRect();
        
        if (cursorCanvas.width !== rect.width || cursorCanvas.height !== rect.height) {
            cursorCanvas.width = rect.width;
            cursorCanvas.height = rect.height;
        }
        cursorCanvas.style.left = this.offsetX + 'px';
        cursorCanvas.style.top = this.offsetY + 'px';
        
        const ctx = cursorCanvas.getContext('2d');
        ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
        
        const x = pos.x * this.scaleFinal;
        const y = pos.y * this.scaleFinal;
        const size = this.brush.size * this.scaleFinal;
        const halfSize = size / 2;
        
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = this.brush.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        
        if (this.brush.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x, y, halfSize, 0, Math.PI * 2);
            ctx.stroke();
        } else if (this.brush.shape === 'square') {
            ctx.strokeRect(x - halfSize, y - halfSize, size, size);
        } else if (this.brush.shape === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(x, y - halfSize);
            ctx.lineTo(x + halfSize, y + halfSize);
            ctx.lineTo(x - halfSize, y + halfSize);
            ctx.closePath();
            ctx.stroke();
        } else if (this.brush.shape.startsWith('svg_')) {
            ctx.strokeRect(x - halfSize, y - halfSize, size, size);
        }
        
        ctx.restore();
    }

    hideCursor() {
        const cursorCanvas = this.canvases.cursor;
        if (!cursorCanvas) return;
        const ctx = cursorCanvas.getContext('2d');
        ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    }

    getCanvasCoordinates(e) {
        const rect = this.canvases.display.getBoundingClientRect();
        const x = (e.clientX - rect.left) / this.scaleFinal;
        const y = (e.clientY - rect.top) / this.scaleFinal;
        return { x, y };
    }

    drawAtPosition(pos) {
        const layer = this.layers[this.currentLayerIndex];
        if (!layer) return;

        const ctx = layer.canvas.getContext('2d');
        this.drawBrush(ctx, pos.x, pos.y);
        this.renderDisplay();
    }

    drawLineToPosition(pos) {
        if (!this.lastDrawPos) {
            this.lastDrawPos = pos;
            this.drawAtPosition(pos);
            return;
        }

        const layer = this.layers[this.currentLayerIndex];
        if (!layer) return;

        const ctx = layer.canvas.getContext('2d');
        const dx = pos.x - this.lastDrawPos.x;
        const dy = pos.y - this.lastDrawPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(distance / (this.brush.size * this.brush.spacing)));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = this.lastDrawPos.x + dx * t;
            const y = this.lastDrawPos.y + dy * t;
            this.drawBrush(ctx, x, y);
        }

        this.lastDrawPos = pos;
        this.renderDisplay();
    }

    drawBrush(ctx, x, y) {
        const halfSize = this.brush.size / 2;
        
        ctx.save();
        ctx.globalAlpha = this.brush.opacity;
        
        if (this.brush.shape === 'circle') {
            ctx.fillStyle = this.brush.color;
            ctx.beginPath();
            ctx.arc(x, y, halfSize, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.brush.shape === 'square') {
            ctx.fillStyle = this.brush.color;
            ctx.fillRect(x - halfSize, y - halfSize, this.brush.size, this.brush.size);
        } else if (this.brush.shape === 'triangle') {
            ctx.fillStyle = this.brush.color;
            ctx.beginPath();
            ctx.moveTo(x, y - halfSize);
            ctx.lineTo(x + halfSize, y + halfSize);
            ctx.lineTo(x - halfSize, y + halfSize);
            ctx.closePath();
            ctx.fill();
        } else if (this.brush.shape.startsWith('svg_')) {
            const svgData = this.svgBrushCache.get(this.brush.shape);
            if (svgData) {
                let svgContent = svgData.content;
                
                let viewBox = '0 0 100 100';
                const viewBoxMatch = svgContent.match(/viewBox="([^"]*)"/i);
                if (viewBoxMatch) {
                    viewBox = viewBoxMatch[1];
                }
                
                const div = document.createElement('div');
                div.innerHTML = `<svg width="${this.brush.size}" height="${this.brush.size}" viewBox="${viewBox}" fill="${this.brush.color}" xmlns="http://www.w3.org/2000/svg">${svgContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)?.[1] || svgContent}</svg>`;
                const svgElement = div.firstChild;
                
                if (svgElement) {
                    const svgString = new XMLSerializer().serializeToString(svgElement);
                    const tempSvg = new Blob([svgString], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(tempSvg);
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, x - halfSize, y - halfSize, this.brush.size, this.brush.size);
                        URL.revokeObjectURL(url);
                        this.renderDisplay();
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        console.error('[Annotation Editor] Failed to load SVG image');
                    };
                    img.src = url;
                }
            }
        }
        
        ctx.restore();
    }

    loadImageFromNode() {
        if (!this.node) {
            console.log('[VPA Editor] No node provided');
            return;
        }

        console.log('[VPA Editor] Looking for image in node...');
        
        let imageUrl = null;
        
        const imageInput = this.node.inputs?.find(inp => inp.name === 'image');
        if (imageInput && imageInput.link !== null) {
            const link = app.graph.links[imageInput.link];
            if (link) {
                const upstreamNode = app.graph.getNodeById(link.origin_id);
                if (upstreamNode) {
                    const upImgWidget = upstreamNode.widgets?.find(w => w.name === 'image');
                    if (upImgWidget && upImgWidget.value) {
                        imageUrl = api.fileURL(`/view?filename=${encodeURIComponent(upImgWidget.value)}&type=input`);
                    } else if (upstreamNode.imgs && upstreamNode.imgs.length > 0) {
                        imageUrl = upstreamNode.imgs[0].src;
                    }
                }
            }
        }
        
        if (imageUrl) {
            console.log('[VPA Editor] Using upstream node image:', imageUrl);
            this.loadImage(imageUrl);
        } else if (this.node.imgs && this.node.imgs.length > 0) {
            console.log('[VPA Editor] Using node.imgs[0].src:', this.node.imgs[0].src);
            this.loadImage(this.node.imgs[0].src);
        } else {
            console.log('[VPA Editor] No image found in node or upstream node');
            alert('请先连接一个包含图片的节点（如 Load Image）！');
        }
    }

    loadImage(src) {
        console.log('[VPA Editor] Loading image:', src);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
            console.log('[VPA Editor] Image loaded successfully');
            this.baseImage = img;
            this.baseImageWidth = img.width;
            this.baseImageHeight = img.height;
            
            this.canvases.baseLayer.width = img.width;
            this.canvases.baseLayer.height = img.height;
            
            const baseCtx = this.canvases.baseLayer.getContext('2d');
            baseCtx.drawImage(img, 0, 0);
            
            await this.initLayers();
            
            this.calculateScale();
            this.renderDisplay();
            this.updateSizeInfo();
            this.renderBrushLibrary();
        };
        img.onerror = () => {
            console.error('[VPA Editor] Failed to load image');
        };
        img.src = src;
    }

    async initLayers() {
        this.layers = [];
        this.currentLayerIndex = -1;
        this.canvases.customLayers = [];
        
        const baseLayer = {
            id: 'base',
            name: '基础层',
            canvas: this.canvases.baseLayer,
            visible: true,
            isBase: true,
            locked: true
        };
        this.layers.push(baseLayer);
        
        const editNameWidget = this.node.widgets?.find(w => w.name === 'edit_name');
        const filename = editNameWidget?.value || 'annotation';
        
        const savedLayers = await this.loadLayersFromServer(filename);
        
        if (savedLayers && savedLayers.length > 0) {
            console.log('[VPA Editor] Restoring saved layers...');
            for (const layerData of savedLayers) {
                const newCanvas = document.createElement('canvas');
                newCanvas.width = this.baseImageWidth;
                newCanvas.height = this.baseImageHeight;
                
                const newLayer = {
                    id: layerData.id,
                    name: layerData.name,
                    canvas: newCanvas,
                    visible: layerData.visible,
                    isBase: false,
                    locked: false
                };
                
                const img = new Image();
                img.onload = () => {
                    const ctx = newCanvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    this.renderDisplay();
                };
                img.src = layerData.imageData;
                
                this.layers.push(newLayer);
                this.canvases.customLayers.push(newCanvas);
            }
            this.currentLayerIndex = this.layers.length - 1;
        } else {
            console.log('[VPA Editor] No saved layers found, creating new layer...');
            this.createNewLayer(true);
        }
        
        this.renderLayerList();
    }

    createNewLayer(isAuto = false) {
        const customLayerCount = this.layers.filter(l => !l.isBase).length;
        if (customLayerCount >= this.maxCustomLayers) {
            if (!isAuto) {
                alert(`最多只能创建 ${this.maxCustomLayers} 个自定义图层`);
            }
            return;
        }

        const newCanvas = document.createElement('canvas');
        newCanvas.width = this.baseImageWidth;
        newCanvas.height = this.baseImageHeight;
        
        const newLayer = {
            id: `layer-${Date.now()}`,
            name: `图层${customLayerCount + 1}`,
            canvas: newCanvas,
            visible: true,
            isBase: false,
            locked: false
        };
        
        this.layers.push(newLayer);
        this.canvases.customLayers.push(newCanvas);
        this.currentLayerIndex = this.layers.length - 1;
        
        console.log('[VPA Editor] Created new layer:', newLayer.name);
        if (!isAuto) {
            this.renderLayerList();
            this.renderDisplay();
        }
    }

    deleteLayer(index) {
        const layer = this.layers[index];
        if (!layer || layer.isBase) return;
        
        if (confirm(`确定要删除 "${layer.name}" 吗？`)) {
            this.layers.splice(index, 1);
            
            if (this.currentLayerIndex >= this.layers.length) {
                this.currentLayerIndex = this.layers.length - 1;
            }
            if (this.layers[this.currentLayerIndex]?.isBase) {
                this.currentLayerIndex = -1;
            }
            
            console.log('[VPA Editor] Deleted layer:', layer.name);
            this.renderLayerList();
            this.renderDisplay();
        }
    }

    toggleLayerVisibility(index) {
        if (index >= 0 && index < this.layers.length) {
            this.layers[index].visible = !this.layers[index].visible;
            console.log('[VPA Editor] Toggled layer visibility:', this.layers[index].name, this.layers[index].visible);
            this.renderLayerList();
            this.renderDisplay();
        }
    }

    selectLayer(index) {
        if (this.layers[index]?.isBase) {
            this.currentLayerIndex = -1;
            console.log('[VPA Editor] Selected base layer (cannot draw)');
        } else {
            this.currentLayerIndex = index;
            console.log('[VPA Editor] Selected layer:', this.layers[index].name);
        }
        this.renderLayerList();
    }

    renderLayerList() {
        const layerList = document.getElementById('layer-list');
        if (!layerList) return;
        
        layerList.innerHTML = '';
        
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            const layerItem = this.createLayerItem(layer, i);
            layerList.appendChild(layerItem);
        }
    }

    createLayerItem(layer, index) {
        const item = document.createElement("div");
        item.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background-color: ${this.currentLayerIndex === index ? 'var(--comfy-input-bg)' : 'var(--comfy-menu-bg)'};
            border: 1px solid var(--border-color);
            border-radius: 4px;
        `;

        const visibilityCheckbox = document.createElement("input");
        visibilityCheckbox.type = 'checkbox';
        visibilityCheckbox.checked = layer.visible;
        visibilityCheckbox.style.cssText = `
            cursor: pointer;
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        `;
        visibilityCheckbox.onclick = (e) => {
            e.stopPropagation();
        };
        visibilityCheckbox.onchange = (e) => {
            e.stopPropagation();
            this.toggleLayerVisibility(index);
        };

        const nameSpan = document.createElement("span");
        nameSpan.style.cssText = `
            flex: 1;
            color: var(--input-text);
            font-size: 12px;
            cursor: pointer;
        `;
        nameSpan.textContent = layer.name;
        nameSpan.onclick = () => this.selectLayer(index);

        if (layer.isBase) {
            const lockSpan = document.createElement("span");
            lockSpan.textContent = "🔒";
            lockSpan.style.cssText = `
                font-size: 12px;
            `;
            item.appendChild(visibilityCheckbox);
            item.appendChild(nameSpan);
            item.appendChild(lockSpan);
        } else {
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "×";
            deleteBtn.style.cssText = `
                background: none;
                border: none;
                color: var(--error-text);
                font-size: 16px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
                flex-shrink: 0;
            `;
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.deleteLayer(index);
            };
            item.appendChild(visibilityCheckbox);
            item.appendChild(nameSpan);
            item.appendChild(deleteBtn);
        }

        return item;
    }

    calculateScale() {
        if (!this.baseImage || !this.canvases.container) return;

        const containerRect = this.canvases.container.getBoundingClientRect();
        const containerWidth = containerRect.width - 20;
        const containerHeight = containerRect.height - 20;

        const scaleW = containerWidth / this.baseImageWidth;
        const scaleH = containerHeight / this.baseImageHeight;
        this.scaleFinal = Math.min(scaleW, scaleH);

        const displayWidth = this.baseImageWidth * this.scaleFinal;
        const displayHeight = this.baseImageHeight * this.scaleFinal;

        this.canvases.display.width = displayWidth;
        this.canvases.display.height = displayHeight;

        this.offsetX = (containerRect.width - displayWidth) / 2;
        this.offsetY = (containerRect.height - displayHeight) / 2;

        this.canvases.display.style.left = this.offsetX + 'px';
        this.canvases.display.style.top = this.offsetY + 'px';
        
        console.log('[VPA Editor] Scale calculated:', this.scaleFinal);
    }

    renderDisplay() {
        const displayCtx = this.canvases.display.getContext('2d');
        displayCtx.clearRect(0, 0, this.canvases.display.width, this.canvases.display.height);
        displayCtx.imageSmoothingEnabled = false;

        for (const layer of this.layers) {
            if (!layer.visible) continue;
            displayCtx.drawImage(
                layer.canvas,
                0, 0, layer.canvas.width, layer.canvas.height,
                0, 0, this.canvases.display.width, this.canvases.display.height
            );
        }
    }

    updateSizeInfo() {
        const sizeInfo = document.getElementById('size-info');
        if (sizeInfo && this.baseImageWidth && this.baseImageHeight) {
            sizeInfo.textContent = `原始尺寸：${this.baseImageWidth}×${this.baseImageHeight} px`;
        }
    }

    setupResizeListener() {
        const resizeObserver = new ResizeObserver(() => {
            this.calculateScale();
            this.renderDisplay();
        });
        
        setTimeout(() => {
            if (this.canvases.container) {
                resizeObserver.observe(this.canvases.container);
            }
        }, 100);
    }

    async applyAndExport() {
        console.log('[VPA Editor] Applying and exporting...');
        
        if (this.layers.filter(l => !l.isBase).length === 0) {
            alert('没有自定义图层可以导出！请先创建图层并绘制。');
            return;
        }

        const filename = this.node.getResolvedFilename ? this.node.getResolvedFilename() : (this.node.widgets?.find(w => w.name === 'edit_name')?.value || 'annotation_01');
        
        await this.saveLayersToServer(filename);

        // Create annotation (transparent PNG)
        const annotationCanvas = document.createElement('canvas');
        annotationCanvas.width = this.baseImageWidth;
        annotationCanvas.height = this.baseImageHeight;
        const annotationCtx = annotationCanvas.getContext('2d');

        for (const layer of this.layers) {
            if (layer.isBase || !layer.visible) continue;
            annotationCtx.drawImage(layer.canvas, 0, 0);
        }

        // Create preview (original + annotation)
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = this.baseImageWidth;
        previewCanvas.height = this.baseImageHeight;
        const previewCtx = previewCanvas.getContext('2d');
        previewCtx.drawImage(this.canvases.baseLayer, 0, 0);
        previewCtx.drawImage(annotationCanvas, 0, 0);

        annotationCanvas.toBlob(async (annotationBlob) => {
            const previewBlob = await new Promise(resolve => previewCanvas.toBlob(resolve, 'image/png'));
            await this.saveAnnotationToNode(annotationBlob, annotationCanvas, previewBlob, previewCanvas, filename);
        }, 'image/png');
    }

    async saveLayersToServer(filename) {
        try {
            console.log('[VPA Editor] Saving layers to server...');
            
            const layersData = this.layers
                .filter(l => !l.isBase)
                .map(layer => ({
                    id: layer.id,
                    name: layer.name,
                    visible: layer.visible,
                    imageData: layer.canvas.toDataURL('image/png')
                }));
            
            const response = await api.fetchApi('/vpa_editor/save_layers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filename: filename,
                    layers: layersData
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('[VPA Editor] Layers saved to server:', result.path);
            } else {
                console.error('[VPA Editor] Failed to save layers:', result.error);
            }
        } catch (error) {
            console.error('[VPA Editor] Error saving layers:', error);
        }
    }

    async loadLayersFromServer(filename) {
        try {
            console.log('[VPA Editor] Loading layers from server...');
            
            const response = await api.fetchApi(`/vpa_editor/load_layers?filename=${encodeURIComponent(filename)}`);
            const result = await response.json();
            
            if (result.success && result.layers) {
                console.log('[VPA Editor] Layers loaded from server');
                return result.layers;
            } else {
                console.log('[VPA Editor] No layers found or failed to load');
                return null;
            }
        } catch (error) {
            console.error('[VPA Editor] Error loading layers:', error);
            return null;
        }
    }

    async saveAnnotationToNode(annotationBlob, annotationCanvas, previewBlob, previewCanvas, filename) {
        try {
            console.log('[VPA Editor] Saving annotation to node...');
            
            const annotationData = annotationCanvas.toDataURL('image/png');
            const previewData = previewCanvas.toDataURL('image/png');
            
            console.log('[VPA Editor] Sending to server...');
            const response = await api.fetchApi('/vpa_editor/save_annotation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filename: filename,
                    image_data: annotationData,
                    preview_data: previewData
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('[VPA Editor] Annotation saved to server:', result.annotation_path);
            } else {
                console.error('[VPA Editor] Failed to save annotation:', result.error);
            }
            
            this.node.annotationData = annotationData;
            this.node.annotationBlob = annotationBlob;
            
            // Trigger UI update using our new custom preview UI
            if (this.node.updateCustomPreviews) {
                this.node.updateCustomPreviews(previewData);
            }
            
            console.log('[VPA Editor] Annotation exported successfully');
            this.close();
        } catch (error) {
            console.error('[VPA Editor] Error saving to node:', error);
            this.close();
        }
    }

    async updateNodePreview(filename) {
        // Obsolete: We now use updateCustomPreviews attached to the node
        console.log('[VPA Editor] Native preview update skipped in favor of custom UI');
    }

    downloadPNG(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'annotation_' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    setupDragging() {
        const titleBar = this.windowElement.querySelector(".vpa-editor-titlebar");
        
        titleBar.addEventListener("mousedown", (e) => {
            this.isDragging = true;
            const rect = this.windowElement.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            this.windowElement.style.transform = "none";
            this.windowElement.style.left = rect.left + "px";
            this.windowElement.style.top = rect.top + "px";
            
            document.addEventListener("mousemove", this.onMouseMove.bind(this));
            document.addEventListener("mouseup", this.onMouseUp.bind(this));
        });
    }

    onMouseMove(e) {
        if (!this.isDragging) return;
        this.windowElement.style.left = (e.clientX - this.dragOffset.x) + "px";
        this.windowElement.style.top = (e.clientY - this.dragOffset.y) + "px";
    }

    onMouseUp() {
        this.isDragging = false;
        document.removeEventListener("mousemove", this.onMouseMove.bind(this));
        document.removeEventListener("mouseup", this.onMouseUp.bind(this));
    }

    close() {
        if (this.windowElement && this.windowElement.parentNode) {
            this.windowElement.parentNode.removeChild(this.windowElement);
        }
    }
}

console.log("[VPA Editor] Registering extension...");

app.registerExtension({
    name: "Comfy.VPAEditor",

    async init() {
        console.log("[VPA Editor] Extension init");
    },

    async setup() {
        console.log("[VPA Editor] Extension setup complete");
    },

    async nodeCreated(node) {
        if (node.comfyClass === "VPAEditorLoadImage") {
            const editNameWidget = node.widgets?.find(w => w.name === "edit_name");

            if (!editNameWidget) return;

            function extractName(filename) {
                if (!filename || filename === "none") return "";
                const baseName = filename.split("/").pop().split("\\").pop();
                return baseName.replace(/\.[^/.]+$/, "");
            }

            function getUpstreamFilename() {
                const imageInput = node.inputs?.find(inp => inp.name === 'image');
                if (imageInput && imageInput.link !== null) {
                    const link = app.graph.links[imageInput.link];
                    if (link) {
                        const upstreamNode = app.graph.getNodeById(link.origin_id);
                        if (upstreamNode) {
                            const upImgWidget = upstreamNode.widgets?.find(w => w.name === 'image');
                            if (upImgWidget && upImgWidget.value) {
                                return upImgWidget.value;
                            }
                        }
                    }
                }
                return null;
            }

            function autoFillName() {
                const filename = getUpstreamFilename();
                let newUpstreamName = "";
                if (filename) {
                    newUpstreamName = extractName(filename);
                }

                // If upstream name has changed (and isn't empty), or the input is empty, update the name.
                // This will overwrite the user's edit if the upstream image actually switches to a new one.
                if (newUpstreamName) {
                    if (editNameWidget._lastUpstreamName !== newUpstreamName || !editNameWidget.value) {
                        editNameWidget.value = newUpstreamName;
                        editNameWidget._lastUpstreamName = newUpstreamName;
                        // Trigger callback to ensure Vue nodes update their UI properly
                        if (editNameWidget.callback) {
                            editNameWidget.callback(editNameWidget.value);
                        }
                    }
                } else {
                    // No upstream image, clear tracking
                    editNameWidget._lastUpstreamName = "";
                }
            }

            async function updateNodePreview() {
                let filename = editNameWidget.value;
                if (!filename) {
                    const upName = getUpstreamFilename();
                    if (upName) {
                        filename = extractName(upName);
                    }
                }
                if (!filename) return;
                
                const previewFilename = filename + '_preview.png';
                const previewUrl = api.fileURL(`/view?filename=${encodeURIComponent(previewFilename)}&type=output&subfolder=VPA_PNG`);
                
                try {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        node.imgs = [img];
                        
                        if (node.setSizeForImage) {
                            node.setSizeForImage();
                        } else if (node.setSize) {
                            node.setSize();
                        }
                        
                        if (app.graph) {
                            app.graph.setDirtyCanvas(true, true);
                        }
                    };
                    img.onerror = () => {
                        console.log('[VPA Editor] No preview found, hiding node preview as requested.');
                        node.imgs = [];
                        if (app.graph) {
                            app.graph.setDirtyCanvas(true, true);
                        }
                    };
                    img.src = previewUrl + '?t=' + Date.now();
                } catch (error) {
                    console.error('[VPA Editor] Error updating node preview:', error);
                }
            }

            node.getResolvedFilename = function() {
                let filename = editNameWidget.value;
                if (!filename) {
                    const upName = getUpstreamFilename();
                    if (upName) {
                        filename = extractName(upName);
                    } else {
                        filename = "annotation";
                    }
                }
                return filename;
            };

            // 使用 addDOMWidget 强力注入按钮和双预览UI
            const uiContainer = document.createElement("div");
            uiContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 100%;
                margin-top: 5px;
            `;

            // 清理系统中自动生成的幽灵预览图，防止UI被其挤压或重叠干扰
            function cleanupGhostWidgets() {
                if (node.widgets) {
                    for (let i = node.widgets.length - 1; i >= 0; i--) {
                        const w = node.widgets[i];
                        if (w.name !== "action_buttons" && w.name !== "edit_name") {
                            if (w.type === "image" || w.name === "image" || w.name === "preview" || w.type === "customtext") {
                                if (w.element) w.element.style.display = "none";
                                w.computeSize = () => [0, 0];
                                node.widgets.splice(i, 1);
                            }
                        }
                    }
                }
            }

            const loadBtn = document.createElement("button");
            loadBtn.textContent = "手动加载 / 刷新图像";
            loadBtn.style.cssText = `
                width: 100%;
                padding: 6px;
                background-color: var(--comfy-input-bg);
                color: var(--input-text);
                border: 1px solid var(--border-color);
                border-radius: 4px;
                cursor: pointer;
                flex-shrink: 0;
            `;

            const openBtn = document.createElement("button");
            openBtn.textContent = "用 VPA Editor 打开";
            openBtn.style.cssText = `
                width: 100%;
                padding: 6px;
                background-color: var(--comfy-input-bg);
                color: var(--input-text);
                border: 1px solid var(--border-color);
                border-radius: 4px;
                cursor: pointer;
                flex-shrink: 0;
            `;

            // 原图预览区域
            const origLabel = document.createElement("div");
            origLabel.textContent = "📝 原图预览：";
            origLabel.style.cssText = `color: var(--input-text); font-size: 12px; margin-top: 4px; flex-shrink: 0;`;
            
            const origImgContainer = document.createElement("div");
            origImgContainer.style.cssText = `
                width: 100%;
                min-height: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                background: rgba(0,0,0,0.2);
                border-radius: 4px;
                flex-shrink: 0;
            `;
            const origImg = document.createElement("img");
            origImg.style.cssText = `max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 4px; display: none;`;
            origImgContainer.appendChild(origImg);

            // 标注预览区域
            const annoLabel = document.createElement("div");
            annoLabel.textContent = "📝 标注预览：";
            annoLabel.style.cssText = `color: var(--input-text); font-size: 12px; margin-top: 4px; flex-shrink: 0;`;
            
            const annoImgContainer = document.createElement("div");
            annoImgContainer.style.cssText = `
                width: 100%;
                min-height: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 20px 20px;
                border-radius: 4px;
                flex-shrink: 0;
            `;
            const annoImg = document.createElement("img");
            annoImg.style.cssText = `max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 4px; display: none;`;
            annoImgContainer.appendChild(annoImg);

            // 绑定到 node 上以便外部 (Editor Window) 也可以调用
            node.updateCustomPreviews = updateCustomPreviews;

            function updateNodeSize() {
                cleanupGhostWidgets();
                if (!node.size || !uiContainer.parentNode) return;
                
                if (domWidget) {
                    domWidget.computeSize = function(width) {
                        return [width, uiContainer.scrollHeight ? uiContainer.scrollHeight + 10 : 0];
                    };
                }

                let minHeight = 60; // 基础标题和边距高度
                if (node.inputs) minHeight += node.inputs.length * 20;
                if (node.outputs) minHeight += node.outputs.length * 20;
                
                const uiHeight = uiContainer.scrollHeight || 0;
                let targetHeight = minHeight + uiHeight + 20;
                
                // 与系统算出的原始大小做对比，取最大值
                if (node.computeSize) {
                    const sysSize = node.computeSize([node.size[0], node.size[1]]);
                    targetHeight = Math.max(targetHeight, sysSize[1]);
                }
                
                // 只有当高度变化显著时才应用，避免无限循环闪烁
                if (Math.abs(node.size[1] - targetHeight) > 2) {
                    node.setSize([node.size[0], targetHeight]);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                }
            }

            // 监听图片加载完毕，自动撑开节点高度
            origImg.onload = updateNodeSize;
            annoImg.onload = updateNodeSize;

            // 使用 ResizeObserver 监听 DOM 变化，彻底防止缩回
            const resizeObserver = new ResizeObserver(() => {
                updateNodeSize();
            });
            // 延迟绑定，等DOM挂载
            setTimeout(() => {
                resizeObserver.observe(uiContainer);
            }, 100);

            // 更新 UI 图像函数
            function updateCustomPreviews(forcedPreviewData = null) {
                cleanupGhostWidgets();
                autoFillName();
                
                // 1. 获取原图
                const upFilename = getUpstreamFilename();
                if (upFilename) {
                    const upstreamUrl = api.fileURL(`/view?filename=${encodeURIComponent(upFilename)}&type=input`);
                    origImg.src = upstreamUrl;
                    origImg.style.display = "block";
                } else {
                    origImg.style.display = "none";
                    origImg.src = "";
                }

                // 2. 获取标注图
                if (forcedPreviewData) {
                    // 当点击“应用”时，直接使用生成的 Base64 预览图更新 UI，做到零延迟、100% 同步
                    annoImg.src = forcedPreviewData;
                    annoImg.style.display = "block";
                    updateNodeSize();
                } else {
                    const filename = node.getResolvedFilename();
                    if (filename) {
                        const previewFilename = filename + '_preview.png';
                        const previewUrl = api.fileURL(`/view?filename=${encodeURIComponent(previewFilename)}&type=output&subfolder=VPA_PNG`);
                        
                        const testImg = new Image();
                        testImg.onload = () => {
                            annoImg.src = previewUrl + '?t=' + Date.now();
                            annoImg.style.display = "block";
                            updateNodeSize();
                        };
                        testImg.onerror = () => {
                            annoImg.style.display = "none";
                            annoImg.src = "";
                            updateNodeSize();
                        };
                        testImg.src = previewUrl + '?t=' + Date.now();
                    } else {
                        annoImg.style.display = "none";
                        annoImg.src = "";
                        updateNodeSize();
                    }
                }
                
                updateNodeSize();
            }

            loadBtn.onclick = () => {
                console.log("[VPA Editor] Manual Load and update preview");
                updateCustomPreviews();
            };

            openBtn.onclick = () => {
                console.log("[VPA Editor] Opening editor window");
                autoFillName();
                new VPAEditorWindow(node);
            };

            uiContainer.appendChild(loadBtn);
            uiContainer.appendChild(openBtn);
            uiContainer.appendChild(origLabel);
            uiContainer.appendChild(origImgContainer);
            uiContainer.appendChild(annoLabel);
            uiContainer.appendChild(annoImgContainer);

            const domWidget = node.addDOMWidget("action_buttons", "btn", uiContainer);
            domWidget.computeSize = function(width) {
                return [width, uiContainer.scrollHeight ? uiContainer.scrollHeight + 10 : 0];
            };

            // 清理并阻止 ComfyUI 原生 canvas 预览，完全依赖我们的 HTML img 标签
            const origOnDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function(ctx) {
                node.imgs = []; // 永远清空原生预览，防止背景闪烁或重叠
                cleanupGhostWidgets(); // 持续清理其他插件乱注的图片预览
                if (origOnDrawForeground) return origOnDrawForeground.apply(this, arguments);
            };
            
            // 监听连线变化事件
            const origOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function(type, index, connected, link_info) {
                if (origOnConnectionsChange) {
                    origOnConnectionsChange.apply(this, arguments);
                }
                // 当输入端口（type===1）的第一个（index===0）发生连线变化时
                if (type === 1 && index === 0) {
                    setTimeout(() => {
                        updateCustomPreviews();
                    }, 100);
                }
            };

            // 初始加载预览
            setTimeout(() => {
                updateCustomPreviews();
            }, 200);
        }
    },
});

console.log("[VPA Editor] Extension registration complete");
