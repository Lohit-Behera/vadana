import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import type { Mesh, ShaderMaterial } from "three";
import { useTheme } from "@/components/ui/theme-provider";
import { normalizeAudioLevel } from "@/lib/audioLevel";

export type SphereActivity = "idle" | "speaking" | "listening" | "thinking";

type SphereProps = {
  activity: SphereActivity;
  audioLevel: number;
  lightTheme: boolean;
};

function SphereMesh({ activity, audioLevel, lightTheme }: SphereProps) {
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const { pointer } = useThree();
  const scaleRef = useRef(1);
  const levelRef = useRef(0);
  const activityRef = useRef(activity);
  const audioRef = useRef(audioLevel);
  const prevActivityRef = useRef(activity);
  activityRef.current = activity;
  audioRef.current = audioLevel;

  useEffect(() => {
    if (prevActivityRef.current !== activity) {
      levelRef.current *= 0.25;
      prevActivityRef.current = activity;
    }
  }, [activity]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uLightTheme: { value: lightTheme ? 1 : 0 },
    }),
    [lightTheme],
  );

  const vertexShader = `
    uniform float uTime;
    uniform float uLevel;
    varying vec2 vUv;
    varying float vDisplacement;
    
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    
    void main() {
      vUv = uv;
      float lvl = uLevel * (1.0 - 0.25 * uLevel);
      float noise = snoise(position * 1.5 + uTime * 0.15);
      float bands = sin(vUv.x * 40.0 + uTime * 8.0) * sin(vUv.y * 32.0 - uTime * 6.0);
      float wave = bands * lvl * 0.11;
      float displacement = noise * (0.055 + lvl * 0.035) + wave;
      displacement = clamp(displacement, -0.13, 0.13);
      vDisplacement = displacement;
      vec3 newPosition = position + normal * displacement;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    varying float vDisplacement;
    uniform float uLevel;
    uniform float uLightTheme;
    
    void main() {
      float lvl = uLevel * (1.0 - 0.2 * uLevel);
      float isLight = step(0.5, uLightTheme);
      vec3 emerald = vec3(0.38, 0.78, 0.62);
      vec3 emeraldBright = vec3(0.32, 0.72, 0.58);
      
      float darkIntensity = 0.26 + vDisplacement * 1.8 + lvl * 0.28;
      vec3 darkColor = mix(vec3(darkIntensity), emerald, 0.28 + lvl * 0.42);
      
      float lightIntensity = 0.42 + vDisplacement * 1.2 + lvl * 0.32;
      vec3 lightColor = mix(emeraldBright * 0.55, emeraldBright, 0.55 + lvl * 0.38);
      lightColor *= 0.85 + lightIntensity * 0.35;
      
      vec3 color = mix(darkColor, lightColor, isLight);
      
      float line = smoothstep(0.0, 0.02, abs(fract(vUv.x * 20.0) - 0.5));
      line *= smoothstep(0.0, 0.02, abs(fract(vUv.y * 20.0) - 0.5));
      float lineMix = mix(0.5, 0.35, isLight);
      float alpha = mix(0.65, 0.88, isLight);
      
      gl_FragColor = vec4(color * (1.0 - line * lineMix), alpha);
    }
  `;

  useFrame((state, delta) => {
    const act = activityRef.current;
    const isThinking = act === "thinking";
    const reactive = act === "speaking" || act === "listening";
    const target = reactive ? normalizeAudioLevel(audioRef.current) : 0;

    levelRef.current = MathUtils.lerp(
      levelRef.current,
      target,
      target > levelRef.current ? 0.32 : 0.14,
    );
    const level = levelRef.current;

    const targetScale = isThinking
      ? 0.68
      : reactive
        ? 0.9 + level * 0.22
        : 1;

    const scaleLerp = isThinking ? 0.22 : 0.16;
    scaleRef.current = MathUtils.lerp(scaleRef.current, targetScale, scaleLerp);

    const shaderTimeSpeed = isThinking
      ? 2.4
      : reactive
        ? 0.9 + level * 1.4
        : 0.35;

    if (materialRef.current) {
      const u = materialRef.current.uniforms;
      u.uTime.value += delta * shaderTimeSpeed;
      u.uLevel.value = isThinking ? level * 0.15 : level;
      u.uLightTheme.value = lightTheme ? 1 : 0;
    }

    if (meshRef.current) {
      const breathe = isThinking
        ? 1 + Math.sin(state.clock.elapsedTime * 5) * 0.02
        : reactive
          ? 1 + level * 0.05 * Math.sin(state.clock.elapsedTime * 12)
          : 1 + Math.sin(state.clock.elapsedTime * 1.2) * 0.01;
      meshRef.current.scale.setScalar(scaleRef.current * breathe);
      const spinY = isThinking ? 0.42 : 0.04 + level * 0.12;
      meshRef.current.rotation.y += delta * spinY;
      meshRef.current.rotation.x = MathUtils.lerp(
        meshRef.current.rotation.x,
        isThinking ? 0.12 : reactive ? level * 0.22 : pointer.y * 0.1,
        isThinking ? 0.12 : 0.08,
      );
      meshRef.current.rotation.z = MathUtils.lerp(
        meshRef.current.rotation.z,
        isThinking ? -0.08 : reactive ? level * 0.16 : pointer.x * 0.1,
        isThinking ? 0.12 : 0.08,
      );
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.8, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        wireframe
      />
    </mesh>
  );
}

type Props = {
  activity?: SphereActivity;
  audioLevel?: number;
  className?: string;
};

export function SentientSphere({
  activity = "idle",
  audioLevel = 0,
  className,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const lightTheme = resolvedTheme === "light";

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={
          className ??
          "flex min-h-0 flex-1 w-full items-center justify-center"
        }
      >
        <div className="border-primary/20 size-48 animate-pulse rounded-full border" />
      </div>
    );
  }

  return (
    <div className={className ?? "min-h-0 flex-1 w-full"}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        className="h-full w-full"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={lightTheme ? 0.85 : 0.5} />
        <SphereMesh
          activity={activity}
          audioLevel={audioLevel}
          lightTheme={lightTheme}
        />
      </Canvas>
    </div>
  );
}
