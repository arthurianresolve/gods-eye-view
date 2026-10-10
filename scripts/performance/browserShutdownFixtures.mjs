export const BLANK_DOCUMENT = String.raw`<!doctype html><meta charset="utf-8"><title>Blank shutdown control</title>`;

export const WEBGL_DOCUMENT = String.raw`<!doctype html><meta charset="utf-8"><title>WebGL shutdown control</title>
<style>html,body{margin:0;width:100%;height:100%;background:#111}canvas{display:block;width:640px;height:480px}</style>
<canvas id="gl" width="640" height="480"></canvas><script>
const canvas=document.getElementById('gl');
const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});
if(gl){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.08,.24,.42,1);gl.clear(gl.COLOR_BUFFER_BIT);}
const frameStarted=performance.now();
requestAnimationFrame(()=>{
  const queryStarted=performance.now();
  const clean=value=>String(value||'').replace(/[\r\n\t]+/g,' ').slice(0,128);
  let debugInfo=null;
  try{debugInfo=gl?.getExtension('WEBGL_debug_renderer_info')||null;}catch{}
  window.__shutdownReady={ready:true,webgl2:!!gl,canvasWidth:canvas.width,canvasHeight:canvas.height,
    readyFrameElapsedMs:Math.max(0,performance.now()-frameStarted),
    renderingContext:gl?{version:clean(gl.getParameter(gl.VERSION)),vendor:clean(gl.getParameter(gl.VENDOR)),
      renderer:clean(gl.getParameter(gl.RENDERER)),debugRendererInfoAvailable:!!debugInfo,
      unmaskedVendor:debugInfo?clean(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)):null,
      unmaskedRenderer:debugInfo?clean(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)):null,
      antialias:gl.getContextAttributes()?.antialias===true,
      alpha:gl.getContextAttributes()?.alpha===true,
      rendererQueryDurationMs:Math.max(0,performance.now()-queryStarted)}:null};
});
</script>`;

export const CESIUM_DOCUMENT = String.raw`<!doctype html><meta charset="utf-8"><title>Cesium shutdown control</title>
<link rel="stylesheet" href="/cesium/Widgets/widgets.css">
<style>html,body,#view{margin:0;width:100%;height:100%;overflow:hidden}</style>
<script>window.CESIUM_BASE_URL='/cesium/';</script><script src="/cesium/Cesium.js"></script>
<div id="view"></div><script>
try{
  const viewer=new Cesium.Viewer('view',{animation:false,timeline:false,geocoder:false,homeButton:false,
    sceneModePicker:false,navigationHelpButton:false,baseLayerPicker:false,fullscreenButton:false,
    infoBox:false,selectionIndicator:false,baseLayer:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),
    requestRenderMode:true,maximumRenderTimeChange:Infinity});
  viewer.scene.globe.show=false;
  const frameStarted=performance.now();
  let postRenderCaptured=false;
  let removePostRender;
  removePostRender=viewer.scene.postRender.addEventListener(()=>{
    if(postRenderCaptured)return;
    postRenderCaptured=true;
    removePostRender?.();
    const queryStarted=performance.now();
    const gl=viewer.scene.context?._originalGLContext||viewer.scene.context?._gl||null;
    const clean=value=>String(value||'').replace(/[\r\n\t]+/g,' ').slice(0,128);
    let debugInfo=null;
    try{debugInfo=gl?.getExtension('WEBGL_debug_renderer_info')||null;}catch{}
    window.__shutdownReady={ready:true,cesium:true,canvasWidth:viewer.canvas.width,canvasHeight:viewer.canvas.height,
      contextAvailable:!!viewer.scene.context,
      readyFrameElapsedMs:Math.max(0,performance.now()-frameStarted),
      renderingContext:gl?{version:clean(gl.getParameter(gl.VERSION)),vendor:clean(gl.getParameter(gl.VENDOR)),
        renderer:clean(gl.getParameter(gl.RENDERER)),debugRendererInfoAvailable:!!debugInfo,
        unmaskedVendor:debugInfo?clean(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)):null,
        unmaskedRenderer:debugInfo?clean(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)):null,
        antialias:gl.getContextAttributes()?.antialias===true,
        alpha:gl.getContextAttributes()?.alpha===true,
        rendererQueryDurationMs:Math.max(0,performance.now()-queryStarted)}:null};
  });
  viewer.scene.requestRender();
  window.__shutdownViewer=viewer;
}catch(error){window.__shutdownReady={ready:false,errorName:String(error?.name||'Error').slice(0,50)}}
</script>`;

export function inlineScripts(document) {
  return [...document.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim().length > 0);
}
