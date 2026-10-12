import { useEffect } from "react";
import type { LiveStatus } from "../hooks/useLiveLocation";

interface PulseOverlayProps {
  map: google.maps.Map | null;
  position: { lat: number; lng: number };
  status: LiveStatus;
}

const COLORS = {
  live: {
    ring: "bg-emerald-400/40",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    label: "● TAWEEL · LIVE",
  },
  stale: {
    ring: "bg-amber-400/40",
    dot: "bg-amber-400",
    text: "text-amber-300",
    label: "◌ LAST KNOWN",
  },
  offduty: {
    ring: "bg-zinc-500/30",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    label: "○ PARKED",
  },
} as const;

/**
 * A blinking "Taweel is here" marker rendered as a DOM overlay on the live map.
 * Radar rings + blinking dot when live; calm amber/zinc when stale/off-duty.
 */
export default function PulseOverlay({ map, position, status }: PulseOverlayProps) {
  useEffect(() => {
    if (!map) return;

    const color = COLORS[status];

    class Pulse extends google.maps.OverlayView {
      private div: HTMLDivElement;
      private pos: google.maps.LatLngLiteral;

      constructor(pos: google.maps.LatLngLiteral) {
        super();
        this.pos = pos;
        this.div = document.createElement("div");
        this.div.style.position = "absolute";
        this.div.style.transform = "translate(-50%, -50%)";
        this.div.style.zIndex = "10";
        this.div.style.pointerEvents = "none";
        this.div.innerHTML = `
          <div style="position:relative;display:grid;place-items:center;width:0;height:0">
            ${
              status === "live"
                ? `<span class="absolute h-12 w-12 rounded-full ${color.ring} animate-radar"></span>
                   <span class="absolute h-12 w-12 rounded-full ${color.ring} animate-radar" style="animation-delay:1.2s"></span>`
                : `<span class="absolute h-10 w-10 rounded-full ${color.ring}"></span>`
            }
            <span class="relative grid h-5 w-5 place-items-center rounded-full border-2 border-white ${color.dot} shadow-lg">
              <span class="h-1.5 w-1.5 rounded-full bg-white ${status === "live" ? "animate-blink" : ""}"></span>
            </span>
            <span class="absolute top-7 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] ${color.text} backdrop-blur-md">
              ${color.label}
            </span>
          </div>`;
      }

      onAdd() {
        this.getPanes()?.markerLayer.appendChild(this.div);
      }

      draw() {
        const projection = this.getProjection();
        if (!projection) return;
        const point = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(this.pos.lat, this.pos.lng)
        );
        if (!point) return;
        this.div.style.left = `${point.x}px`;
        this.div.style.top = `${point.y}px`;
      }

      onRemove() {
        this.div.parentNode?.removeChild(this.div);
      }
    }

    const overlay = new Pulse(position);
    overlay.setMap(map);
    return () => {
      overlay.setMap(null);
    };
  }, [map, position.lat, position.lng, status]);

  return null;
}
