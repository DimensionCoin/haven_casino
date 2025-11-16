// components/cointoss/CoinToss3DScene.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

export type CoinSide = "heads" | "tails";

type CoinToss3DSceneProps = {
  isTossing: boolean;
  finalSide?: CoinSide;
  highlightWin?: boolean;
};

type CoinMeshProps = {
  isTossing: boolean;
  finalSide?: CoinSide;
  highlightWin?: boolean;
  onPositionUpdate?: (pos: THREE.Vector3) => void;
};

const TOSS_DURATION = 2.2;

function CameraController({
  isTossing,
  finalSide,
  highlightWin,
  coinPosition,
}: {
  isTossing: boolean;
  finalSide?: CoinSide;
  highlightWin?: boolean;
  coinPosition: THREE.Vector3;
}) {
  const { camera } = useThree();
  const tossStartTimeRef = useRef<number | null>(null);
  const phaseRef = useRef<"idle" | "zoomOut" | "follow" | "zoomIn" | "settle">(
    "idle"
  );

  useEffect(() => {
    if (isTossing) {
      tossStartTimeRef.current = null;
      phaseRef.current = "zoomOut";
    } else if (finalSide) {
      phaseRef.current = "zoomIn";
    } else {
      phaseRef.current = "idle";
    }
  }, [isTossing, finalSide]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (tossStartTimeRef.current === null && isTossing) {
      tossStartTimeRef.current = t;
    }

    const elapsed =
      tossStartTimeRef.current !== null ? t - tossStartTimeRef.current : 0;

    if (phaseRef.current === "zoomOut") {
      const norm = Math.min(elapsed / 0.3, 1);
      const ease = 1 - Math.pow(1 - norm, 4);

      const targetZ = THREE.MathUtils.lerp(4.5, 9, ease); // ⬅️ further out
      const targetY = THREE.MathUtils.lerp(2.0, 4.2, ease); // slightly higher

      camera.position.z = targetZ;
      camera.position.y = targetY;
      camera.position.x = coinPosition.x * 0.4;

      camera.lookAt(coinPosition.x, coinPosition.y + 0.4, coinPosition.z);

      if (norm >= 1) phaseRef.current = "follow";
    } else if (phaseRef.current === "follow") {
      if (elapsed < TOSS_DURATION * 0.7) {
        camera.position.x =
          coinPosition.x * 0.8 + Math.sin(elapsed * 2.2) * 0.35;
        camera.position.y = coinPosition.y + 1.6;
        camera.position.z = 8.5 + Math.cos(elapsed * 1.1) * 2.0;

        camera.lookAt(coinPosition.x, coinPosition.y - 0.2, coinPosition.z);
      } else {
        phaseRef.current = "zoomIn";
      }
    } else if (phaseRef.current === "zoomIn") {
      const norm = Math.min((elapsed - TOSS_DURATION * 0.7) / 0.8, 1);
      const clamped = Math.max(norm, 0);
      const ease = Math.pow(clamped, 4);

      // ⬅️ Reveal shot is now pulled back more
      camera.position.z = THREE.MathUtils.lerp(8.5, 4.5, ease);
      camera.position.y = THREE.MathUtils.lerp(3.6, 1.6, ease);
      camera.position.x = THREE.MathUtils.lerp(
        coinPosition.x * 0.6,
        coinPosition.x * 0.2,
        ease
      );

      camera.lookAt(coinPosition.x, coinPosition.y, coinPosition.z);

      if (clamped >= 1) phaseRef.current = "settle";
    } else if (phaseRef.current === "settle") {
      // ⬅️ Orbit wider & stay back more
      const angle = t * (highlightWin ? 0.7 : 0.3);
      const radius = highlightWin ? 0.9 : 0.6;

      camera.position.x = coinPosition.x + Math.sin(angle) * radius;
      camera.position.z = coinPosition.z + 4.2 + Math.cos(angle) * 0.35;
      camera.position.y = 1.5 + Math.sin(t * 0.4) * 0.03;

      camera.lookAt(coinPosition.x, coinPosition.y, coinPosition.z);
    } else {
      // Idle framing also a bit wider
      const idleNorm = (Math.sin(t * 0.2) + 1) / 2;
      camera.position.z = THREE.MathUtils.lerp(4.2, 5.2, idleNorm);
      camera.position.y = 1.9 + Math.cos(t * 0.1) * 0.1;
      camera.position.x = coinPosition.x * 0.2;

      camera.lookAt(coinPosition.x, coinPosition.y, coinPosition.z);
    }

    camera.updateProjectionMatrix();
  });

  return null;
}


function CoinMesh({
  isTossing,
  finalSide,
  highlightWin,
  onPositionUpdate,
}: CoinMeshProps) {
  const coinRef = useRef<THREE.Mesh | null>(null);
  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const [materials, setMaterials] = useState<THREE.Material[]>([]);
  const [phase, setPhase] = useState<"idle" | "toss" | "landing" | "settle">(
    "idle"
  );
  const tossStartTimeRef = useRef<number | null>(null);
  const velocityRef = useRef<number>(0);
  const angularVelocityRef = useRef<number>(0);
  const bounceCountRef = useRef<number>(0);
  const coinPositionRef = useRef(new THREE.Vector3(0, 0.4, 0));

  // --- textures/materials (unchanged) ---
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const headsTexture = loader.load(
      "/coinhead.png",
      () => setTexturesLoaded(true),
      undefined,
      (err) => {
        console.error("[CoinMesh] Failed to load /coinhead.png", err);
        setTexturesLoaded(true);
      }
    );
    const tailsTexture = loader.load(
      "/cointail.png",
      () => setTexturesLoaded(true),
      undefined,
      (err) => {
        console.error("[CoinMesh] Failed to load /cointail.png", err);
        setTexturesLoaded(true);
      }
    );

    headsTexture.wrapS = headsTexture.wrapT = THREE.ClampToEdgeWrapping;
    tailsTexture.wrapS = tailsTexture.wrapT = THREE.ClampToEdgeWrapping;

    const metalColor = new THREE.Color("#facc15");

    const topMaterial = new THREE.MeshStandardMaterial({
      map: headsTexture,
      roughness: 0.08,
      metalness: 0.95,
    });
    const bottomMaterial = new THREE.MeshStandardMaterial({
      map: tailsTexture,
      roughness: 0.08,
      metalness: 0.95,
    });
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: metalColor,
      roughness: 0.15,
      metalness: 0.98,
    });

    setMaterials([sideMaterial, topMaterial, bottomMaterial]);

    return () => {
      headsTexture.dispose();
      tailsTexture.dispose();
      topMaterial.dispose();
      bottomMaterial.dispose();
      sideMaterial.dispose();
    };
  }, []);

  // --- phase changes (unchanged) ---
  useEffect(() => {
    if (isTossing) {
      setPhase("toss");
      tossStartTimeRef.current = null;
      velocityRef.current = 22;
      angularVelocityRef.current = Math.random() * 12 + 22;
      bounceCountRef.current = 0;
      coinPositionRef.current.set(0, 0.4, 0);
    } else if (finalSide) {
      setPhase("landing");
    } else {
      setPhase("idle");
    }
  }, [isTossing, finalSide]);

  const getTargetRotation = (side: CoinSide): THREE.Euler => {
    const euler = new THREE.Euler();
    if (side === "heads") {
      euler.set(0, 0, 0);
    } else {
      euler.set(Math.PI, 0, 0);
    }
    return euler;
  };

  // --- toss physics (unchanged) ---
  useFrame((state, delta) => {
    const mesh = coinRef.current;
    if (!mesh || !texturesLoaded) return;

    const t = state.clock.getElapsedTime();
    const gravity = -32 * delta;

    if (phase === "toss") {
      if (tossStartTimeRef.current === null) {
        tossStartTimeRef.current = t;
      }

      const elapsed = t - tossStartTimeRef.current;

      coinPositionRef.current.y += velocityRef.current * delta;
      velocityRef.current += gravity;
      coinPositionRef.current.x = Math.sin(elapsed * 6) * 0.25;

      mesh.position.copy(coinPositionRef.current);

      const spinEase = Math.sin((elapsed * Math.PI) / TOSS_DURATION);
      angularVelocityRef.current -= spinEase * 0.5;
      mesh.rotation.x += angularVelocityRef.current * delta;
      mesh.rotation.z = Math.sin(elapsed * 15) * 0.5;

      if (coinPositionRef.current.y <= 0.4) {
        coinPositionRef.current.y = 0.4;
        setPhase("landing");
        velocityRef.current = -velocityRef.current * 0.8;
        angularVelocityRef.current *= 0.9;
        bounceCountRef.current += 1;
      }

      onPositionUpdate?.(coinPositionRef.current.clone());
    } else if (phase === "landing") {
      coinPositionRef.current.y += velocityRef.current * delta;
      velocityRef.current += gravity;
      mesh.position.copy(coinPositionRef.current);

      mesh.rotation.x += angularVelocityRef.current * delta;
      mesh.rotation.z += Math.sin(t * 30) * 0.4 * delta;

      if (coinPositionRef.current.y <= 0.4) {
        coinPositionRef.current.y = 0.4;
        bounceCountRef.current += 1;
        if (bounceCountRef.current >= 5 || Math.abs(velocityRef.current) < 1) {
          setPhase("settle");
          coinPositionRef.current.y = 0.4;
          velocityRef.current = 0;
        } else {
          velocityRef.current =
            -velocityRef.current * 0.7 ** bounceCountRef.current;
          angularVelocityRef.current *= 0.75;
        }
      }

      onPositionUpdate?.(coinPositionRef.current.clone());
    } else if (phase === "settle") {
      if (!finalSide) return;

      const targetEuler = getTargetRotation(finalSide);
      const lerpFactor = 0.08;

      coinPositionRef.current.y = 0.4 + Math.sin(t * 5) * 0.01;
      mesh.position.copy(coinPositionRef.current);

      const currentQuat = new THREE.Quaternion().setFromEuler(mesh.rotation);
      const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      currentQuat.slerp(targetQuat, lerpFactor);

      mesh.setRotationFromQuaternion(currentQuat);

      angularVelocityRef.current *= 0.96;
      if (Math.abs(angularVelocityRef.current) < 0.01)
        angularVelocityRef.current = 0;

      onPositionUpdate?.(coinPositionRef.current.clone());
    } else {
      coinPositionRef.current.y = 0.4 + Math.sin(t * 1) * 0.05;
      coinPositionRef.current.x = Math.cos(t * 0.5) * 0.1;
      mesh.position.copy(coinPositionRef.current);

      mesh.rotation.y += delta * 1.5;
      mesh.rotation.x = Math.sin(t * 0.6) * 0.2;

      onPositionUpdate?.(coinPositionRef.current.clone());
    }
  });

  const coinGlowIntensity = highlightWin ? 2.5 : 1.0;
  const coinColor = highlightWin ? "#22c55e" : "#facc15";

  return (
    <group>
      {/* table */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <circleGeometry args={[6, 128]} />
        <meshStandardMaterial
          color="#0a0a0a"
          roughness={0.99}
          metalness={0.01}
        />
      </mesh>

      {/* glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[2.2, 64]} />
        <meshBasicMaterial
          color={coinColor}
          transparent
          opacity={highlightWin ? 1.0 : 0.6}
        />
      </mesh>

      {/* coin */}
      <mesh ref={coinRef} position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.5, 0.04, 128]} />
        {materials.length === 3 ? (
          <>
            <primitive object={materials[0]} attach="material-0" />
            <primitive object={materials[1]} attach="material-1" />
            <primitive object={materials[2]} attach="material-2" />
          </>
        ) : (
          <meshStandardMaterial
            color={coinColor}
            metalness={0.98}
            roughness={0.05}
            emissive={coinColor}
            emissiveIntensity={coinGlowIntensity * 0.3}
          />
        )}
      </mesh>

      {/* lighting */}
      <ambientLight intensity={0.8} color="#ffffff" />
      <directionalLight
        position={[2, 5, 3]}
        intensity={3.0}
        castShadow
        color="#ffffff"
        shadow-mapSize-width={8192}
        shadow-mapSize-height={8192}
        shadow-camera-near={0.1}
        shadow-camera-far={15}
      />
      <directionalLight position={[-2, 4, 2]} intensity={1.8} color="#fde68a" />
      <spotLight
        position={[0, 1, -4]}
        intensity={2.5}
        angle={0.3}
        penumbra={0.5}
        color={coinColor}
        distance={5}
        castShadow
      />
      <directionalLight
        position={[0, 3, -6]}
        intensity={1.5}
        color={coinColor}
      />
    </group>
  );
}

export function CoinToss3DScene(props: CoinToss3DSceneProps) {
  const { isTossing, finalSide, highlightWin } = props;
  const coinPositionRef = useRef(new THREE.Vector3(0, 0.4, 0));

  return (
    <div className="w-full h-full bg-gradient-to-b from-black via-slate-950 to-black rounded-2xl overflow-hidden border border-zinc-700/80 shadow-[0_0_40px_rgba(0,0,0,0.9)]">
      <Canvas
        shadows
        camera={{ position: [0, 2.0, 5.2], fov: 30 }} // ⬅️ pulled back
        className="w-full h-full"
      >
        <color attach="background" args={["#020617"]} />
        <fog attach="fog" args={["#020617", 8, 20]} />

        <CoinMesh
          isTossing={isTossing}
          finalSide={finalSide}
          highlightWin={highlightWin}
          onPositionUpdate={(pos) => coinPositionRef.current.copy(pos)}
        />
        <CameraController
          isTossing={isTossing}
          finalSide={finalSide}
          highlightWin={highlightWin}
          coinPosition={coinPositionRef.current}
        />

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          enableRotate={false}
          minPolarAngle={0.6}
          maxPolarAngle={1.2}
        />
      </Canvas>
    </div>
  );
}

