/* Render a prepainted odor-field backdrop; no environment or sampling model. */
export class OdorFieldLayer {
  async load() {
    if(!this.promise) this.promise=(async()=>{
      this.image=new Image();this.image.src='./media/odor-field.png';await this.image.decode();
    })();
    return this.promise;
  }
  draw(ctx,{width,height,unproject,time=0}) {
    if(!this.image?.complete||!this.image.naturalWidth)return;
    const o=unproject([0,0]),x=unproject([width,0]),y=unproject([0,height]);
    const a=(x[0]-o[0])/width,b=(x[1]-o[1])/width,c=(y[0]-o[0])/height,d=(y[1]-o[1])/height,det=a*d-b*c;
    const project=(p)=>[(d*(p[0]-o[0])-c*(p[1]-o[1]))/det,(-b*(p[0]-o[0])+a*(p[1]-o[1]))/det];
    const p=project([-6,10]),q=project([34,10]),r=project([-6,-10]);
    ctx.save();ctx.globalAlpha=.61+.035*Math.sin(time*.8);
    ctx.transform((q[0]-p[0])/this.image.width,(q[1]-p[1])/this.image.width,(r[0]-p[0])/this.image.height,(r[1]-p[1])/this.image.height,p[0],p[1]);
    ctx.drawImage(this.image,0,0);ctx.restore();
  }
}
