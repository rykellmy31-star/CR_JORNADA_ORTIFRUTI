/**
 * Impede ampliação por pinça/double tap no site móvel.
 *
 * Não bloqueia scroll normal (um dedo), swipes em listas horizontais,
 * campos, seleção nem recursos de zoom do próprio sistema operacional.
 * Safari iOS pode ignorar o atributo user-scalable=no; os eventos gesture*
 * e touch com múltiplos toques são a proteção adicional.
 */
export const isTouchZoomGesture = (touchCount:number,coarseScreen:boolean):boolean =>
  coarseScreen && touchCount>1;

export function installMobileViewportGuards():()=>void{
  const onMobile=()=>window.matchMedia('(max-width: 980px) and (pointer: coarse)').matches;
  const blockPinch=(e:TouchEvent)=>{
    if(isTouchZoomGesture(e.touches.length,onMobile()))e.preventDefault();
  };
  const blockGesture=(e:Event)=>{
    if(onMobile())e.preventDefault();
  };
  // Safari exige passive:false para cancelar os gestos de pinça.
  const opts:AddEventListenerOptions={passive:false};
  document.addEventListener('touchstart',blockPinch,opts);
  document.addEventListener('touchmove',blockPinch,opts);
  document.addEventListener('gesturestart',blockGesture,opts);
  document.addEventListener('gesturechange',blockGesture,opts);
  document.addEventListener('dblclick',blockGesture,opts);
  return ()=>{
    document.removeEventListener('touchstart',blockPinch);
    document.removeEventListener('touchmove',blockPinch);
    document.removeEventListener('gesturestart',blockGesture);
    document.removeEventListener('gesturechange',blockGesture);
    document.removeEventListener('dblclick',blockGesture);
  };
}
