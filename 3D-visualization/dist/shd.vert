#version 300 es
precision highp float;

layout (location = 0) in vec3 in_pos;

uniform float u_time;
uniform float zoom;
uniform mat4 matrWVP;

mat4 MatrScale(vec3 Sv) {
    return mat4(
        vec4(Sv.x, 0.0,  0.0,  0.0),
        vec4(0.0,  Sv.y, 0.0,  0.0),
        vec4(0.0,  0.0,  Sv.z, 0.0),
        vec4(0.0,  0.0,  0.0,  1.0));
}

mat4 MatrRotateX(float AngleInDegree) {
    float a = radians(AngleInDegree), sine = sin(a), cosine = cos(a);
    return mat4(
        vec4(1.0, 0.0,     0.0,    0.0),
        vec4(0.0, cosine,  sine,   0.0),
        vec4(0.0, -sine,   cosine, 0.0),
        vec4(0.0, 0.0,     0.0,    1.0));
}

mat4 MatrRotateZ(float AngleInDegree) {
    float a = radians(AngleInDegree), sine = sin(a), cosine = cos(a);
    return mat4(
        vec4(cosine, -sine,  0.0, 0.0),
        vec4(sine,   cosine, 0.0, 0.0),
        vec4(0.0,    0.0,    1.0, 0.0),
        vec4(0.0,    0.0,    0.0, 1.0));
}

void main() {
    mat4 extraMatrix = MatrRotateX(0.0 * sin(u_time)) * MatrRotateZ(0.0 * sin(u_time)) * MatrScale(vec3(zoom));

    gl_Position = matrWVP * extraMatrix * vec4(in_pos, 1.0);
}