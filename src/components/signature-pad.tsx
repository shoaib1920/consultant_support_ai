"use client";

import * as React from "react";
import { signAckAction } from "@/server/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { Button, Field, Input } from "./ui/primitives";

export function SignaturePad({ ackId }: { ackId: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [data, setData] = React.useState("");
  const drawing = React.useRef(false);
  const [ua, setUa] = React.useState("");
  React.useEffect(() => setUa(navigator.userAgent), []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  return (
    <ActionForm action={signAckAction.bind(null, ackId)}>
      <input type="hidden" name="signature" value={data} />
      <input type="hidden" name="ua" value={ua} />
      <Field label="Type your full name exactly as on your passport"><Input name="signedName" required /></Field>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Draw your signature</div>
        <canvas
          ref={canvas}
          width={600}
          height={160}
          className="h-40 w-full touch-none rounded-md border bg-white"
          aria-label="Signature area"
          onPointerDown={(e) => {
            drawing.current = true;
            const c = e.currentTarget.getContext("2d")!;
            const p = pos(e);
            c.beginPath();
            c.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const c = e.currentTarget.getContext("2d")!;
            c.lineWidth = 2.5;
            c.lineCap = "round";
            c.strokeStyle = "#111";
            const p = pos(e);
            c.lineTo(p.x, p.y);
            c.stroke();
          }}
          onPointerUp={(e) => {
            drawing.current = false;
            setData(e.currentTarget.toDataURL("image/png"));
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setData(""); }}>Clear</Button>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-1" /> I have read and understood these risks. I agree to proceed knowing that non-refundable fees may be lost.</label>
      <div><SubmitButton disabled={!data}>Sign acknowledgment</SubmitButton></div>
    </ActionForm>
  );
}
