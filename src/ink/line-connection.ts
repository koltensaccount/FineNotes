import type { ShapeKind, Stroke } from "../model/document";
import { editEndpoint } from "./shape-edit";

/** Snap recognized lines only. Existing strokes remain untouched and independently undoable. */
export function connectRecognizedLine(kind: ShapeKind, points: readonly number[], strokes: readonly Stroke[], tolerance: number): number[] {
  if(kind !== "line" || points.length < 6) return points.slice();
  let out=points.slice();
  for(const endpoint of ["start","end"] as const) {
    const i=endpoint === "start" ? 0 : 3, far=endpoint === "start" ? 3 : 0;
    let best: {stroke:Stroke; index:number; distance:number} | null=null;
    for(const stroke of strokes) {
      if(stroke.tool !== "pen" || stroke.shape !== "line" || stroke.pts.length < 6) continue;
      for(const index of [0,3]) {
        const distance=Math.hypot(out[i]-stroke.pts[index],out[i+1]-stroke.pts[index+1]);
        if(distance<=tolerance && (!best || distance<best.distance)) best={stroke,index,distance};
      }
    }
    if(!best) continue;
    const {stroke,index}=best, other=index === 0 ? 3 : 0;
    const at={x:stroke.pts[index],y:stroke.pts[index+1]};
    const dx=at.x-stroke.pts[other],dy=at.y-stroke.pts[other+1],length=Math.hypot(dx,dy);
    if(length<1) continue;
    const vx=out[far]-at.x,vy=out[far+1]-at.y,span=Math.hypot(vx,vy);
    if(span<1) continue;
    out=editEndpoint("line",out,endpoint,at);
    const projection=(vx*dx+vy*dy)/length;
    // Only an outward, nearly collinear continuation inherits the old angle.
    if(projection>0 && projection/span>=Math.cos(Math.PI/18)) {
      out=editEndpoint("line",out,endpoint === "start" ? "end" : "start",{x:at.x+dx/length*projection,y:at.y+dy/length*projection});
    }
  }
  return out;
}
