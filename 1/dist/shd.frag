#version 300 es
precision highp float;
layout (location = 0) out vec4 o_color;

uniform float u_time;
uniform int Width;
uniform int Height;
uniform float OffsetX;
uniform float OffsetY;            
uniform float zoom;
uniform float ui_colorR;
uniform float ui_colorG;
uniform float ui_colorB;
uniform int u_IsPause;

vec2 Add(vec2 Z1, vec2 Z2) {
    vec2 X;

    X.x = Z1.x + Z2.x;
    X.y = Z1.y + Z2.y;
    return X;
}

vec2 Mul(vec2 Z1, vec2 Z2) {
    vec2 X;

    X.x = Z1.x * Z2.x - Z2.y * Z1.y;
    X.y = Z1.x * Z2.y + Z2.x * Z1.y;
    return X;
}

int F(vec2 Z0) {
    vec2 Z = Z0;
    int n = 0;

    while ((Z.x * Z.x + Z.y *  Z.y) < 4.0 && n < 255) {
        n++;
        Z = Add(Mul(Z, Z), Z0);
    }
    return n;
}

int J(vec2 Z0, vec2 C) {
    vec2 Z = Z0;
    int n = 0;

    while ((Z.x * Z.x + Z.y *  Z.y) < 4.0 && n < 255) {
        n++;
        Z = Add(Mul(Z, Z), C);
    }
    return n;
}

void main() {
    float ndc_x = (gl_FragCoord.x / float(Width)) * 2.0 - 1.0;
    float ndc_y = (gl_FragCoord.y / float(Height)) * 2.0 - 1.0; 
    vec2 Z = vec2(ndc_x * (2.0 / zoom) + OffsetX, ndc_y * (2.0 / zoom) + OffsetY);
    int n = J(Z, vec2(1.5 * sin(u_time), 1.7 * sin(u_time * 1.5)));
    vec3 ui_color = vec3(ui_colorR, ui_colorG, ui_colorB);

    o_color = vec4((mix(vec3(float(n) * 52.0 / 255.0, float(n) * 47.0 / 255.0,
                    float(n) * 30.0 / 255.0), ui_color, gl_FragCoord.x / float(Width) * sin(u_time) + gl_FragCoord.y / float(Height) * sin(u_time))) * vec3(0.4), 1);
}