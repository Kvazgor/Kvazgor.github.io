import { mat4, vec3 } from 'gl-matrix';
let timeFromStart = 0, shaderFs, shaderVs, u_time_location, u_width, u_height, gl, startTime = new Date();
let vertexBuffer, indexBuffer, indicesCount, vao;
let matrWorld = mat4.create(), matrWVP, u_matrWVP, u_zoom, zoom = 1.0, isDown = false, rotateAngle = { x: 0, y: 0, z: 0 }, prevMPos = { x: 0, y: 0 }, deltaMPos = { x: 0, y: 0 }; 

const ZOOM_SPEED = 0.05;
const ROTATION_SPEED = 0.005;

matrWorld = mat4.identity(matrWorld);

function initGL(canvas) {
    gl = canvas.getContext("webgl2");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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

    u_zoom = gl.getUniformLocation(program, "zoom");
    u_matrWVP = gl.getUniformLocation(program, "matrWVP");
    u_time_location = gl.getUniformLocation(program, "u_time");
    u_height = gl.getUniformLocation(program, "Height");
    u_width = gl.getUniformLocation(program, "Width");
}

function initBuffer(vertices, indexes) {
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
 
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
   
    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indexes), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
}

function createSaddle(N, size, a, b) {
    const vertexes = [];
    const indexes = [];

       for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * size - (size / 2); 
        for (let j = 0; j < N; j++) {
            const y = (j / (N - 1)) * size - (size / 2);
            const z = ((x * x) / (a * a) - (y * y) / (b * b)) / 2.0;
            vertexes.push(x, y, z);  
        }
    }

    for (let i = 0; i < N - 1; i++) {
        for (let j = 0; j < N - 1; j++) {
            const i0 = i * N + j;
            const i1 = i0 + 1;
            const i2 = (i + 1) * N + j;
            const i3 = i2 + 1;            
            
            indexes.push(i0, i1, i2);
            indexes.push(i1, i3, i2);
        }
    }

    initBuffer(vertexes, indexes);
    indicesCount = indexes.length;
}

function calculateMatrices(camera, screen) {
    const projMatrix = mat4.create();
    const viewMatrix = mat4.create();
    const vpMatrix = mat4.create();
    const fovRadians = (screen.fov * Math.PI) / 180;
    
    mat4.perspective(projMatrix, fovRadians, screen.aspect, screen.near, screen.far);
    mat4.lookAt(viewMatrix, camera.position, camera.target, camera.up);
    mat4.multiply(vpMatrix, projMatrix, viewMatrix);
    return {
        projection: projMatrix,
        view: viewMatrix,
        vp: vpMatrix
    };
}

function drawScene() {
    gl.clearColor(0, 1, 0, 1);
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const camera = {
        position: vec3.fromValues(3, 4, 7), 
        target: vec3.fromValues(0, 0, 0),   
        up: vec3.fromValues(0, 1, 0)        
    };
    const screenSettings = {
        fov: 60,
        aspect: gl.canvas.clientWidth / gl.canvas.clientHeight,
        near: 0.1,
        far: 100.0
    };
    const matrices = calculateMatrices(camera, screenSettings);
    const trans = mat4.create(); 
    
    matrWVP = mat4.create();
    mat4.multiply(matrWVP, matrices.vp, matrWorld);    
    
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indicesCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    timeFromStart = (new Date() - startTime);
    gl.uniform1f(u_time_location, timeFromStart / 1000.0);
    gl.uniform1f(u_zoom, zoom);
    gl.uniform1i(u_height, gl.viewportHeight);
    gl.uniform1i(u_width, gl.viewportWidth);
    gl.uniformMatrix4fv(u_matrWVP, false, matrWVP);
    window.requestAnimationFrame(drawScene);
}

export async function onStart() {
    let canvas = document.getElementById("webgl-canvas");

    canvas.onwheel = (ev) => {
        if (ev.deltaY < 0 && zoom <= 10.0)
            zoom += ZOOM_SPEED;
        else if (ev.deltaY > 0  && zoom > 0.1)
            zoom -= ZOOM_SPEED;
    }
    
    canvas.onmousedown = (ev) => {
        prevMPos = { x: ev.x, y: ev.y };
        isDown = true;
    };
    canvas.onmouseup = () => {
        isDown = false;
    };
    canvas.onmousemove = (ev) => {
        if (isDown)
        {
            deltaMPos = { x: ev.x - prevMPos.x, y: ev.y - prevMPos.y };
            if (deltaMPos.x !== 0 && deltaMPos.y !== 0)
            {
                let matrRotateX = mat4.create(), matrRotateY = mat4.create(), deltaRotate = mat4.create();

                mat4.fromRotation(matrRotateY, deltaMPos.x * ROTATION_SPEED, vec3.fromValues(0, 1, 0));
                mat4.fromRotation(matrRotateX, deltaMPos.y * ROTATION_SPEED, vec3.fromValues(1, 0, 0));
                mat4.multiply(deltaRotate, matrRotateX, matrRotateY);

                mat4.multiply(matrWorld, deltaRotate, matrWorld);
            }      
            prevMPos = { x: ev.x, y: ev.y };  
        } 
        
    };

    initGL(canvas);
    try {
        const responseVs = await fetch("shd.vert");
        shaderVs = await responseVs.text();

        const responseFs = await fetch("shd.frag");
        shaderFs = await responseFs.text();
      
        initShaders();
        createSaddle(32, 8, 3, 3);
        drawScene();
        
    } catch (err) {}
}
window.onload = onStart();