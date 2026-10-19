// Resizing a canvas clears its drawing buffer. Keep resize and redraw together,
// including while gameplay is paused; observers must only invalidate the size.
export class ViewportFrame {
  constructor({renderer,camera,viewport,orbit,isInspect}){
    Object.assign(this,{renderer,camera,viewport,orbit,isInspect});
    this.pending=true;
  }
  invalidate(){this.pending=true;}
  resize(){
    const {renderer,camera,viewport,orbit}=this;
    const {width,height}=viewport.getBoundingClientRect();
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
    const ratio=renderer.getPixelRatio();
    const pixelWidth=Math.floor(width*ratio),pixelHeight=Math.floor(height*ratio);
    if(!pixelWidth||!pixelHeight)return;
    const aspect=width/height,oldFactor=Math.max(1.08,.56/camera.aspect);
    if(renderer.domElement.width!==pixelWidth||renderer.domElement.height!==pixelHeight){
      renderer.setSize(width,height,false);
    }
    if(camera.aspect!==aspect){
      camera.aspect=aspect;camera.updateProjectionMatrix();
      if(this.isInspect()){
        const newFactor=Math.max(1.08,.56/aspect);
        camera.position.sub(orbit.target).multiplyScalar(newFactor/oldFactor).add(orbit.target);
        orbit.update();
      }
    }
  }
  render(scene){
    if(this.pending){this.pending=false;this.resize();}
    this.renderer.render(scene,this.camera);
  }
}
