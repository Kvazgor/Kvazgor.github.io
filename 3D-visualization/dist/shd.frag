#version 300 es
precision highp float;
layout (location = 0) out vec4 o_color;

uniform float u_time;
uniform int Width;
uniform int Height;

void main() {
    o_color = vec4(float(gl_FragCoord.x) / float(Width) * abs(sin(u_time)), float(gl_FragCoord.y) / float(Height) * abs(sin(u_time)), (float(gl_FragCoord.x) / float(Width) + float(gl_FragCoord.y) / float(Height)) / 2.0, 1);
}