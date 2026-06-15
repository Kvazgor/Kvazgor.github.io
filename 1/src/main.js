import { Pane } from 'tweakpane';

let pauseTime = 0, saveTimeFromStart = 0, timeFromStart = 0, shaderFs, shaderVs, u_IsPause, u_colorR, u_colorG, u_colorB, u_time_location, u_width, u_zoom, u_offsety, u_height, u_offsetx, gl, startTime = new Date(), IsDown, IsPause = 0, zoom = 1.0, OffsetX = 0, OffsetY = 0, MouseOffsetY = 0, MouseOffsetX = 0, SaveOffsetX = 0, SaveOffsetY = 0;
const params = {
    factor: 30,
    title: "Color change test",
    color: { r: 73, g: 31, b: 170 },
};
const ZOOM_SPEED = 0.1;

window.addEventListener("load", (ev) => {
    const pane = new Pane();
    pane.addBinding(params, "factor");
    pane.addBinding(params, "color");
    pane.addBinding(params, "title"); 
})

function initGL(canvas) {
    gl = canvas.getContext("webgl2");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;
}

function getShader(shaderStr, type) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, shaderStr);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(shader));
    }

    return shader;
}

function initShaders() {

    const fs = getShader(shaderFs, gl.FRAGMENT_SHADER);
    const vs = getShader(shaderVs, gl.VERTEX_SHADER);

    const program = gl.createProgram();  
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert("Program linkage error");
    }

    gl.useProgram(program);

    u_colorR = gl.getUniformLocation(program, "ui_colorR");
    u_colorG = gl.getUniformLocation(program, "ui_colorG");
    u_colorB = gl.getUniformLocation(program, "ui_colorB");
    u_zoom = gl.getUniformLocation(program, "zoom");
    u_time_location = gl.getUniformLocation(program, "u_time");
    u_height = gl.getUniformLocation(program, "Height");
    u_width = gl.getUniformLocation(program, "Width");
    u_offsetx = gl.getUniformLocation(program, "OffsetX");
    u_offsety = gl.getUniformLocation(program, "OffsetY");
    u_IsPause = gl.getUniformLocation(program, "IsPause"); 
}

function initBuffer() {
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const vertices = [-1, 3, -1, -1, 3, -1];
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.STATIC_DRAW
    );
}

function drawScene() {
    gl.clearColor(0, 1, 0, 1);
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (IsPause)
    {
        saveTimeFromStart = timeFromStart;
        gl.uniform1f(u_time_location, saveTimeFromStart / 1000.0);
    }
    else
    {
        timeFromStart = new Date() - startTime - pauseTime;
        gl.uniform1f(u_time_location, timeFromStart / 1000.0);
    }
    gl.uniform1f(u_offsetx, OffsetX);
    gl.uniform1f(u_offsety, OffsetY);
    gl.uniform1f(u_zoom, zoom);
    gl.uniform1i(u_height, gl.viewportHeight);
    gl.uniform1i(u_width, gl.viewportWidth);
    gl.uniform1i(u_IsPause, IsPause);
    gl.uniform1f(u_colorR, params.color.r / 255.0);
    gl.uniform1f(u_colorG, params.color.g / 255.0);
    gl.uniform1f(u_colorB, params.color.b / 255.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    window.requestAnimationFrame(drawScene);
}

export async function onStart() {
    let canvas = document.getElementById("webgl-canvas");
    window.onmousedown = (ev) => {
        MouseOffsetX = ev.offsetX; 
        MouseOffsetY = ev.offsetY;         
        IsDown = true;
    };
    
    window.onmouseup = (ev) => {
        SaveOffsetX = OffsetX;
        SaveOffsetY = OffsetY;
        IsDown = false;
    };
    window.onmousemove = (ev) => {
        if (IsDown)
        {
            const dx = ev.offsetX - MouseOffsetX;
            const dy = ev.offsetY - MouseOffsetY;
            
            OffsetX -= dx * (4.0 * zoom) / canvas.width;
            OffsetY += dy * (4.0 * zoom) / canvas.height;
            
            MouseOffsetX = ev.offsetX;
            MouseOffsetY = ev.offsetY;
        }   
    }
    window.onwheel = (ev) => 
    {
        const mouseX = ev.offsetX;
        const mouseY = ev.offsetY;
        const oldZoom = zoom;

        if (ev.deltaY < 0 && zoom <= 50.0) 
            zoom += ZOOM_SPEED;
        else if (ev.deltaY > 0 && zoom > 0.1)
            zoom -= ZOOM_SPEED;
        const ndc_x = (mouseX / canvas.width) * 2.0 - 1.0;
        const ndc_y = -(mouseY / canvas.height) * 2.0 + 1.0;
        const zoomFactorChange = 2.0 * (1.0 / oldZoom - 1.0 / zoom);

        OffsetX += ndc_x * zoomFactorChange;
        OffsetY += ndc_y * zoomFactorChange;
    }
    document.addEventListener("keydown", function(ev) {
        if (ev.key === " ")
        {
            if (IsPause == 0)
                IsPause = 1;
            else
            {
                pauseTime = new Date() - timeFromStart - startTime;
                console.log(`${pauseTime}`);
                IsPause = 0;
            }
        }
    })

    initGL(canvas);
    try {
        const responseVs = await fetch("shd.vert");
        shaderVs = await responseVs.text();

        const responseFs = await fetch("shd.frag");
        shaderFs = await responseFs.text();
      
        initShaders();
        initBuffer();
        drawScene();
        
    } catch (error) {
        console.error("Couldn't load shdaders:", error);
    }
}
window.onload = onStart();