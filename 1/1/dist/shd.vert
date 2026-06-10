#version 300 es
precision highp float;

layout (location = 0) in vec2 a_pos;

uniform float OffsetX;
uniform float OffsetY;
uniform int Width;
uniform int Height;

void main() {
    gl_Position = vec4(a_pos + vec2(0.0), 0, 1);
}
