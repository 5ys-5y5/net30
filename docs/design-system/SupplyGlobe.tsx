"use client";

import createGlobe from "cobe";
import { useEffect, useRef } from "react";
import { GlobeCanvas, GlobeInteraction, GlobeOverlay, GlobeRoot } from "./index";
import { GLOBE } from "./tokens";
import { GLOBE_OVERLAY_KIND } from "./tokens";

export type SupplyStop = { id: string; city: string; location: [number, number] };
export type SupplyArc = { id: string; from: [number, number]; to: [number, number]; cost: string };

export function SupplyGlobe({ stops, arcs, active, ariaLabel, nodeLabel }: { stops: SupplyStop[]; arcs: SupplyArc[]; active: number; ariaLabel: string; nodeLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);

  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    if (!canvasRef.current || !interactionRef.current) return;
    const canvas = canvasRef.current;
    const interaction = interactionRef.current;
    let phi = GLOBE.initialPhi;
    let frame = 0;
    let interacting = false;
    let lastX = 0;
    let velocity = 0;
    const size = canvas.offsetWidth;
    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, GLOBE.devicePixelRatioMax),
      width: size * GLOBE.resolutionScale,
      height: size * GLOBE.resolutionScale,
      phi,
      theta: GLOBE.theta,
      dark: GLOBE.dark,
      diffuse: GLOBE.diffuse,
      mapSamples: GLOBE.mapSamples,
      mapBrightness: GLOBE.mapBrightness,
      mapBaseBrightness: GLOBE.mapBaseBrightness,
      baseColor: GLOBE.baseColor,
      glowColor: GLOBE.glowColor,
      markerColor: GLOBE.markerColor,
      markerElevation: GLOBE.markerElevation,
      arcs: arcs.map(({ id, from, to }) => ({ id, from, to })),
      arcColor: GLOBE.arcColor,
      arcWidth: GLOBE.arcWidth,
      arcHeight: GLOBE.arcHeight,
      scale: GLOBE.scale,
      offset: GLOBE.offset,
      opacity: GLOBE.opacity,
      markers: stops.map((stop, index) => ({ id: stop.id, location: stop.location, size: index === activeRef.current ? GLOBE.activeMarkerSize : GLOBE.markerSize })),
    });

    const pointerDown = (event: PointerEvent) => {
      interacting = true;
      lastX = event.clientX;
      velocity = 0;
      interaction.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!interacting) return;
      const delta = (event.clientX - lastX) / GLOBE.dragSensitivity;
      phi += delta;
      velocity = delta;
      lastX = event.clientX;
    };
    const pointerUp = (event: PointerEvent) => {
      interacting = false;
      if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
    };
    const animate = () => {
      if (!interacting) {
        phi += GLOBE.rotationSpeed + velocity;
        velocity *= GLOBE.velocityDecay;
        if (Math.abs(velocity) < GLOBE.minimumVelocity) velocity = 0;
      }
      globe.update({
        phi,
        markers: stops.map((stop, index) => ({ id: stop.id, location: stop.location, size: index === activeRef.current ? GLOBE.activeMarkerSize : GLOBE.markerSize })),
        arcs: arcs.map(({ id, from, to }) => ({ id, from, to })),
      });
      frame = requestAnimationFrame(animate);
    };

    interaction.addEventListener("pointerdown", pointerDown);
    interaction.addEventListener("pointermove", pointerMove);
    interaction.addEventListener("pointerup", pointerUp);
    interaction.addEventListener("pointercancel", pointerUp);
    animate();
    requestAnimationFrame(() => { canvas.style.opacity = "1"; });
    return () => {
      cancelAnimationFrame(frame);
      interaction.removeEventListener("pointerdown", pointerDown);
      interaction.removeEventListener("pointermove", pointerMove);
      interaction.removeEventListener("pointerup", pointerUp);
      interaction.removeEventListener("pointercancel", pointerUp);
      globe.destroy();
    };
  }, [stops, arcs]);

  const activeStop = stops[active];
  const activeArc = arcs[Math.max(0, active - 1)];
  return <GlobeInteraction ref={interactionRef}><GlobeRoot aria-label={ariaLabel}><GlobeCanvas ref={canvasRef}/>{activeStop && <GlobeOverlay kind={GLOBE_OVERLAY_KIND.node} anchor={`--cobe-${activeStop.id}`} opacity={`var(--cobe-visible-${activeStop.id}, 0)`}>{nodeLabel}</GlobeOverlay>}{activeArc && <GlobeOverlay kind={GLOBE_OVERLAY_KIND.cost} anchor={`--cobe-arc-${activeArc.id}`} opacity={`var(--cobe-visible-arc-${activeArc.id}, 0)`}>{activeArc.cost}</GlobeOverlay>}</GlobeRoot></GlobeInteraction>;
}
