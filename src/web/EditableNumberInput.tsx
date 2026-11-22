import {useEffect,useRef,useState,type InputHTMLAttributes} from 'react';

type EditableNumberProps=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'defaultValue'|'onChange'|'type'> & {
 value:number;
 onValueChange:(numberValue:number)=>void;
};

/**
 * Keep the text being typed separate from the saved number.
 * Clearing every digit never emits zero or a fallback value.
 * Empty, incomplete and out-of-range values stay visible and block native form submission.
 */
export function parseEditableNumber(raw:string,min?:number,max?:number,step?:number|string):number|null{
 if(raw.trim()==='')return null;
 // Não converter o campo vazio em 0 nem aceitar notação científica em quantidades e preços.
 if(!/^-?\d+(?:\.\d+)?$/.test(raw.trim()))return null;
 const parsed=Number(raw);
 if(!Number.isFinite(parsed)||parsed<=(Number.MAX_SAFE_INTEGER*-1)||parsed>Number.MAX_SAFE_INTEGER)return null;
 if(min!==undefined&&parsed<min||max!==undefined&&parsed>max)return null;
 if(step===1||step==='1'){
  if(!Number.isSafeInteger(parsed))return null;
 }
 return parsed;
}
export default function EditableNumberInput({value,onValueChange,min,max,step,required=true,onFocus,onBlur,...rest}:EditableNumberProps){
 const [draft,setDraft]=useState(String(value));
 const focused=useRef(false);
 useEffect(()=>{if(!focused.current)setDraft(String(value));},[value]);
 return <input {...rest} type="number" inputMode={step==='0.01'||step===0.01?'decimal':'numeric'} value={draft} min={min} max={max} step={step} required={required}
  onFocus={event=>{focused.current=true;onFocus?.(event);}}
  onChange={event=>{
   const text=event.target.value;
   setDraft(text);
   const valid=parseEditableNumber(text,typeof min==='number'?min:undefined,typeof max==='number'?max:undefined,step);
   if(valid!==null)onValueChange(valid);
  }}
  onBlur={event=>{focused.current=false;onBlur?.(event);}}/>;
}
