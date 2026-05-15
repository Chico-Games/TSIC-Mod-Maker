import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Unreal-Editor-style perspective camera navigation.
 *
 * - RMB drag: mouse-look (yaw + pitch), WASD/QE/Shift-boost fly while held
 * - LMB drag: mouse-look + WASD fly (same as RMB — convenience)
 * - MMB drag: pan in screen plane
 * - Wheel: dolly along view direction
 * - F: focus on origin (or selection bounds in the future)
 * - No damping, no inertia, no auto-rotation
 */
export function UnrealCameraControls({ baseSpeed = 800 }: { baseSpeed?: number }) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const mouse = useRef({ lmb: false, rmb: false, mmb: false, lastX: 0, lastY: 0 });
  const speedRef = useRef(baseSpeed);

  useEffect(() => {
    const dom = gl.domElement as HTMLCanvasElement;
    dom.tabIndex = 0;

    const onContextMenu = (e: Event) => e.preventDefault();
    const onPointerDown = (e: PointerEvent) => {
      dom.focus();
      if (e.button === 0) mouse.current.lmb = true;
      else if (e.button === 1) { mouse.current.mmb = true; e.preventDefault(); }
      else if (e.button === 2) mouse.current.rmb = true;
      mouse.current.lastX = e.clientX;
      mouse.current.lastY = e.clientY;
      try { dom.setPointerCapture(e.pointerId); } catch {}
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) mouse.current.lmb = false;
      else if (e.button === 1) mouse.current.mmb = false;
      else if (e.button === 2) mouse.current.rmb = false;
      try { dom.releasePointerCapture(e.pointerId); } catch {}
    };
    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - mouse.current.lastX;
      const dy = e.clientY - mouse.current.lastY;
      mouse.current.lastX = e.clientX;
      mouse.current.lastY = e.clientY;
      const { lmb, rmb, mmb } = mouse.current;
      if (!lmb && !rmb && !mmb) return;

      if (mmb) {
        const panScale = camera.position.length() * 0.0015 + 0.5;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(right, -dx * panScale);
        camera.position.addScaledVector(up, dy * panScale);
        return;
      }
      // Mouse-look (RMB or LMB drag).
      const sens = 0.0035;
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= dx * sens;
      euler.x -= dy * sens;
      const limit = Math.PI / 2 - 0.01;
      euler.x = Math.max(-limit, Math.min(limit, euler.x));
      camera.quaternion.setFromEuler(euler);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) { e.preventDefault(); }
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const distScale = camera.position.length() * 0.001 + 1;
      camera.position.addScaledVector(dir, -e.deltaY * distScale);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === 'KeyF') {
        camera.position.lerpVectors(camera.position, new THREE.Vector3(800, 800, 800), 0.0);
        camera.lookAt(0, 0, 0);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const onBlur = () => {
      keys.current = {};
      mouse.current.lmb = mouse.current.rmb = mouse.current.mmb = false;
    };

    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const { lmb, rmb } = mouse.current;
    if (!lmb && !rmb) return;
    const k = keys.current;
    const move = new THREE.Vector3();
    if (k.KeyW) move.z -= 1;
    if (k.KeyS) move.z += 1;
    if (k.KeyA) move.x -= 1;
    if (k.KeyD) move.x += 1;
    if (k.KeyE) move.y += 1;
    if (k.KeyQ) move.y -= 1;
    if (move.lengthSq() === 0) return;
    move.normalize().applyQuaternion(camera.quaternion);
    const boost = k.ShiftLeft || k.ShiftRight ? 4 : k.ControlLeft || k.ControlRight ? 0.25 : 1;
    camera.position.addScaledVector(move, speedRef.current * boost * dt);
  });

  return null;
}
