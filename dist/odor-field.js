/* Render a prepainted odor-field backdrop; no environment or sampling model. */
export class OdorFieldLayer {
  async load() {
    if(!this.promise) this.promise=(async()=>{
      const image=new Image();image.src='./media/odor-field.png';await image.decode();
      this.image=document.createElement('canvas');
      this.image.width=image.naturalWidth;this.image.height=image.naturalHeight;
      const ctx=this.image.getContext('2d');
      const {width,height}=this.image;
      ctx.drawImage(image,0,0);
      // Blend the backdrop into the plot instead of exposing its rectangular edge.
      ctx.globalCompositeOperation='destination-in';
      for(const [x,y,fade] of [[width,0,.08],[0,height,.24]]) {
        const mask=ctx.createLinearGradient(0,0,x,y);
        mask.addColorStop(0,'transparent');mask.addColorStop(fade,'#fff');
        mask.addColorStop(1-fade,'#fff');mask.addColorStop(1,'transparent');
        ctx.fillStyle=mask;ctx.fillRect(0,0,width,height);
      }
    })().catch(error=>{this.promise=null;this.image=null;throw error;});
    return this.promise;
  }
  draw(ctx,{width,height,unproject,source,time=0}) {
    if(!this.image?.width)return;
    const o=unproject([0,0]),x=unproject([width,0]),y=unproject([0,height]);
    const a=(x[0]-o[0])/width,b=(x[1]-o[1])/width,c=(y[0]-o[0])/height,d=(y[1]-o[1])/height,det=a*d-b*c;
    const project=(p)=>[(d*(p[0]-o[0])-c*(p[1]-o[1]))/det,(-b*(p[0]-o[0])+a*(p[1]-o[1]))/det];
    // Enlarge the presentation texture around the source, keeping it aligned.
    const expand=([x,y])=>[source[0]+(x-source[0])*1.2,source[1]+(y-source[1])*1.2];
    const p=project(expand([-6,10])),q=project(expand([34,10])),r=project(expand([-6,-10]));
    ctx.save();ctx.globalAlpha=.61+.035*Math.sin(time*.8);
    ctx.transform((q[0]-p[0])/this.image.width,(q[1]-p[1])/this.image.width,(r[0]-p[0])/this.image.height,(r[1]-p[1])/this.image.height,p[0],p[1]);
    ctx.drawImage(this.image,0,0);ctx.restore();
  }
}
