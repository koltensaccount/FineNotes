import {it,expect} from "vitest";
import {connectRecognizedLine} from "../../src/ink/line-connection";
import type {Stroke} from "../../src/model/document";
const line: Stroke={id:"l1",shape:"line",tool:"pen",size:2,color:"#000",pts:[0,100,.5,100,100,.5]};
it("joins an extension exactly and aligns it to the existing line without modifying that line",()=>{
 const original=line.pts.slice();
 const out=connectRecognizedLine("line",[103,102,.3,200,106,.7],[line],12);
 expect(out.slice(0,2)).toEqual([100,100]); expect(out[4]).toBe(100);
 expect(out[2]).toBe(.3); expect(out[5]).toBe(.7); expect(line.pts).toEqual(original);
});
it("aligns extensions of oblique lines, not just horizontal or vertical ones",()=>{
 const diagonal={...line,pts:[0,0,.5,100,100,.5]};
 const out=connectRecognizedLine("line",[102,100,.5,201,198,.5],[diagonal],12);
 expect(out[0]).toBe(100);expect(out[1]).toBe(100);expect(out[3]).toBe(out[4]);
});
it("keeps intentional corners while joining a nearby endpoint",()=>{
 const out=connectRecognizedLine("line",[102,100,.5,102,200,.5],[line],12);
 expect(out.slice(0,2)).toEqual([100,100]);expect(out.slice(3,5)).toEqual([102,200]);
});
it("does not attract distant strokes, handwriting, highlighters or other shapes",()=>{
 const points=[200,105,.5,300,105,.5];
 expect(connectRecognizedLine("line",points,[line],12)).toEqual(points);
 expect(connectRecognizedLine("rect",points,[line],12)).toEqual(points);
 const near=[102,100,.5,200,106,.5];
 expect(connectRecognizedLine("line",near,[{...line,shape:undefined}],12)).toEqual(near);
 expect(connectRecognizedLine("line",near,[{...line,tool:"highlighter"}],12)).toEqual(near);
});
