import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,Navigate,useLocation,useNavigate} from 'react-router-dom';
import {createPortal,flushSync} from 'react-dom';
import {Apple,ArrowLeft,ArrowRight,BarChart3,Box,Check,ChevronDown,Clock,DoorOpen,Eye,EyeOff,Leaf,LogOut,Menu,MessageCircle,Package,Plus,RefreshCw,Search,Settings,ShoppingBasket,ShoppingCart,Store,Truck,Users,Trash2,X,LayoutDashboard,Tags,History,ClipboardList,ShieldCheck,Send,Image as ImageIcon,Phone,MapPin,Printer} from 'lucide-react';
import {calculateLineTotalCents,formatBRL,formatWeightGrams,formatQuantityDisplay,parseBRLToCents,getDiscountPercent,ORDER_STATUS_LABELS,PAYMENT_METHOD_LABELS} from '../shared/pricing';
import {countCartItems,removeCartSelection} from '../shared/cart';
import {vanityStoreSlug,storeHomeUrl,hortifrutiHomeRoute,HORTIFRUTI_ADMIN_URL} from '../shared/store-domain';
import {prepareBrandImage,IMAGE_ACCEPT} from './image-upload';
import CarouselManager from './CarouselManager';
import PrintingPanel from './PrintingPanel';
import OrderPrintReceipt from './OrderPrintReceipt';
import {LoyaltyPanel,LoyaltyNotice} from './Loyalty';
import {getStoreStatus,readSchedule,type StoreStatus} from '../shared/store-hours';
import {StoreStatusNotice,StoreScheduleEditor} from './StoreHours';
import {CustomProductCard,CustomConfigEditor,newCustomConfig,newPizzaConfig} from './CustomProduct';
import {readCustomConfig,resolveCustomSelection,customUnitPrice,customSelectionKey,type CustomSelection} from '../shared/custom-product';
import MobileBagBar from './MobileBagBar';
import StoreShareButton from './StoreShareButton';
import WhatsAppAutoReplies from './WhatsAppAutoReplies';
import {loadCheckoutIdentity,saveCheckoutIdentity,clearCheckoutIdentity,emptyCheckoutIdentity} from './checkout-memory';
import FixedPriceProductCard from './FixedPriceProductCard';

const API='/api';
async function req(path:string,options:RequestInit={},token?:string):Promise<any>{const headers=new Headers(options.headers||{});if(options.body&&!(options.body instanceof FormData))headers.set('Content-Type','application/json');if(token)headers.set('Authorization',`Bearer ${token}`);const r=await fetch(`${API}${path}`,{...options,headers});const data:any=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);return data;}
async function reqWithTimeout(path:string,options:RequestInit={},token?:string,timeoutMs=45000):Promise<any>{
 const controller=new AbortController();
 const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const headers=new Headers(options.headers||{});
  if(options.body&&!(options.body instanceof FormData))headers.set('Content-Type','application/json');
  if(token)headers.set('Authorization',`Bearer ${token}`);
  const response=await fetch(`${API}${path}`,{...options,headers,signal:controller.signal});
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Erro HTTP ${response.status} ao salvar a imagem.`);
  return data;
 }catch(error:any){
  if(error?.name==='AbortError')throw new Error(`O servidor demorou mais de ${Math.round(timeoutMs/1000)} segundos para responder. Tente novamente. A tela foi liberada.`);
  if(error instanceof TypeError)throw new Error('Falha de conexão durante o envio da imagem. Verifique a internet e tente novamente.');
  throw error;
 }finally{window.clearTimeout(timer);}
}
const img=(url?:string)=>url||'/images/products/placeholder.svg';
const money=(c:number)=>formatBRL(Number(c||0));

const DEVELOPER_CREDIT='Desenvolvido por Carlos Rykellmy Santos Correia';
function DeveloperCredit(){return <footer className="developer-credit" aria-label="Créditos do desenvolvedor">
  {DEVELOPER_CREDIT}
</footer>}
export default function App(){
 const loc=useLocation();
 const vanity=vanityStoreSlug(window.location.hostname);
 const homeRoute=hortifrutiHomeRoute(window.location.hostname);
 const page=loc.pathname==='/'&&homeRoute?<Navigate to={homeRoute} replace/>:
   loc.pathname==='/'&&vanity?<Storefront slugOverride={vanity}/>:
   loc.pathname.startsWith('/loja/')?<Storefront/>:
   loc.pathname.startsWith('/admin')?<Admin/>:
   loc.pathname.startsWith('/superadmin')?<SuperAdmin/>:
   loc.pathname.startsWith('/pedido/')?<Tracking/>:<Landing/>;
 return <>{page}<DeveloperCredit/></>;
}

function Landing(){return <div className="landing">
 <header className="landing-nav">
  <div className="brand express-brand"><span className="brand-mark"><Store size={23}/></span><span>CR Jornada <b>Express</b></span></div>
  <nav><a href="#recursos">Plataforma</a><Link className="btn btn-outline" to="/admin">Acessar painel</Link></nav>
 </header>
 <main>
  <section className="hero">
   <div className="hero-copy">
    <span className="eyebrow"><span className="pulse"></span> SUA LOJA ONLINE, DO SEU JEITO</span>
    <h1>Seu comércio.<br/><em>Mais perto de todos.</em></h1>
    <p>Seu comércio online, simples e rápido! Crie sua vitrine, cadastre produtos, organize pedidos e controle o estoque em uma única plataforma.</p>
    <div className="hero-actions"><Link className="btn btn-soft btn-lg" to="/admin">Entrar no painel <ArrowRight size={17}/></Link></div>
    <div className="hero-proof"><span className="express-segment-pill">🥬 Hortifrutis</span><span className="express-segment-pill">🛒 Mercados</span><span className="express-segment-pill">🏪 Mercearias</span></div>
   </div>
   <div className="hero-art express-hero-art" aria-label="Exemplo ilustrativo de uma vitrine online">
    <div className="art-glow"/>
    <div className="express-showcase">
     <div className="express-showcase-top"><span className="express-showcase-icon"><Store size={24}/></span><span><strong>Minha Loja Online</strong><small>Vitrine digital · Exemplo ilustrativo</small></span><span className="express-showcase-open">Aberta</span></div>
     <div className="express-showcase-categories"><span>Todos</span><span>Hortifruti</span><span>Mercearia</span><span>Ofertas</span></div>
     <div className="express-showcase-grid">
      {[['🍌','Banana','Por kg'],['🍚','Arroz','Pacote'],['🥬','Alface','Unidade'],['☕','Café','Pacote']].map(([emoji,name,mode])=><div className="express-showcase-product" key={name}><span aria-hidden="true">{emoji}</span><b>{name}</b><small>{mode}</small></div>)}
     </div>
     <div className="express-showcase-checkout"><span><ShoppingCart size={17}/> Carrinho de compras</span><span>Finalizar pedido <ArrowRight size={14}/></span></div>
    </div>
    <div className="float-card"><span className="float-icon"><ShoppingCart size={19}/></span><span><b>Pedido recebido!</b><small>Nova venda na sua loja</small></span><Check className="float-check" size={19}/></div>
    <div className="float-tag">⚡ CR Jornada Express</div>
   </div>
  </section>
  <section id="recursos" className="features">
   <div className="section-title"><span className="eyebrow">SIMPLES PARA O CLIENTE. PODEROSO PARA O LOJISTA.</span><h2>Tudo que sua loja precisa<br/>para crescer no digital.</h2></div>
   <div className="feature-grid">{[
    [ShoppingCart,'Vitrine e pedidos','Uma loja online própria, com carrinho e pedidos organizados.'],
    [Package,'Estoque inteligente','Venda por peso, unidade e variações, com controle de estoque.'],
    [MessageCircle,'WhatsApp integrado','Notificações de pedidos quando o estabelecimento configura a integração.'],
    [ShieldCheck,'Cada loja com seu painel','Produtos, vendas, configurações e clientes separados por estabelecimento.']
   ].map(([I,title,copy]:any)=><article className="feature-card" key={title}><div className="feature-icon"><I size={22}/></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
  </section>
  <section className="express-segments"><span className="eyebrow">UMA PLATAFORMA, VÁRIAS POSSIBILIDADES</span><h2>Feito para diferentes tipos de comércio</h2><div className="express-segment-grid"><span>🥬 Hortifrutis e verdurões</span><span>🍎 Frutarias e sacolões</span><span>🛒 Mercados e minimercados</span><span>🏪 Mercearias e empórios</span></div></section>
 </main>
 <footer className="footer"><div className="brand express-brand"><span className="brand-mark"><Store size={20}/></span>CR Jornada <b>Express</b></div><span>Seu comércio online, simples e rápido!</span></footer>
</div>;}

type PurchaseMode='weight'|'unit'|'variants';
type CartLine={product:any;variant?:any;purchaseMode:PurchaseMode;quantity:number;customization?:CustomSelection};
const productIsDual=(p:any)=>p.sale_mode==='weight'&&Number.isInteger(p.unit_price_cents)&&p.unit_price_cents>0&&Number.isInteger(p.unit_weight_grams)&&p.unit_weight_grams>0;
const cartLineOriginalPrice=(line:CartLine):number=>{
 if(line.variant)return line.variant.price_cents;
 if(line.purchaseMode==='unit'&&productIsDual(line.product))return line.product.unit_price_cents;
 return line.product.price_cents;
};
const cartLinePrice=(line:CartLine):number=>{
 const original=cartLineOriginalPrice(line);
 // Não mostrar desconto quando preço promocional é maior ou igual ao original.
 const promo=line.variant?line.variant.promo_price_cents:
   (line.purchaseMode==='unit'&&productIsDual(line.product)?null:line.product.promo_price_cents);
 const base=Number.isInteger(promo)&&promo>=0&&promo<original?promo:original;
 return line.customization?customUnitPrice(base,resolveCustomSelection(readCustomConfig(line.product.custom_config_json)!,line.customization)):base;
};
const cartLineTotal=(line:CartLine)=>calculateLineTotalCents(cartLinePrice(line),line.quantity,line.purchaseMode,line.product.pricing_unit_grams||1000);
const cartLineKey=(line:CartLine)=>[line.product.id,line.variant?.id||'',line.purchaseMode,customSelectionKey(line.customization)].join(':');

/** Imagem sem recorte: texto e botão ficam fora da arte, inclusive em celular. */
function StoreBannerCarousel({store,banners}:{store:any;banners:any[]}){
 const slides=banners.length?banners:[{id:'default',image_url:'',mobile_image_url:null}];
 const [index,setIndex]=useState(0);
 useEffect(()=>setIndex(0),[store.id]);
 useEffect(()=>{
  if(slides.length<2||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const timer=window.setInterval(()=>{
   if(document.visibilityState==='visible')setIndex(i=>(i+1)%slides.length);
  },6000);
  return()=>window.clearInterval(timer);
 },[slides.length,store.id]);
 const selected=slides[index%slides.length];
 const go=(delta:number)=>setIndex(i=>(i+delta+slides.length)%slides.length);
 return <section className="store-banner-carousel" aria-label="Banners da loja">
  <div className={`store-banner-frame ${selected.mobile_image_url?'has-mobile-banner':''}`}>
   {selected.image_url?<picture key={selected.id}>
    {selected.mobile_image_url&&<source media="(max-width:680px)" srcSet={selected.mobile_image_url}/>}
    <img className="store-banner-image" src={selected.image_url}
     alt={`Banner ${index%slides.length+1} de ${store.name}`} loading="eager" decoding="async"/>
   </picture>:<div className="store-banner-express-default" role="img" aria-label="Vitrine de produtos variados">
    <div className="store-banner-express-emojis" aria-hidden="true">🛒 🍎 🥖 🥬</div>
    <strong>Bem-vindo à nossa loja!</strong><span>Produtos, novidades e ofertas para você</span>
   </div>}
  </div>
  <div className="store-banner-bottom">
   <div className="store-banner-copy">
    <strong>{store.banner_title||'Bem-vindo à nossa loja!'}</strong>
    <span>{store.banner_subtitle||'Confira nossos produtos e ofertas.'}</span>
   </div>
   {slides.length>1&&<div className="store-banner-controls" aria-label="Navegar pelos banners">
    <button type="button" onClick={()=>go(-1)} aria-label="Banner anterior"><ArrowLeft size={17}/></button>
    <div className="store-banner-dots" aria-label="Selecionar banner">
     {slides.map((s:any,i:number)=><button type="button" key={s.id} className={index===i?'active':''}
      aria-label={`Ver banner ${i+1}`} aria-current={index===i?'true':undefined} onClick={()=>setIndex(i)}/>)}
    </div>
    <button type="button" onClick={()=>go(1)} aria-label="Próximo banner"><ArrowRight size={17}/></button>
   </div>}
   <a href="#catalogo" className="btn btn-primary store-banner-shop">Ver produtos <ArrowRight size={16}/></a>
  </div>
 </section>;
}

type LogoPalette={primary:string;button:string;accent:string;pageBackground:string;surface:string;text:string};
function extractLogoPalette(file:File):Promise<LogoPalette>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Não foi possível ler a logomarca para extrair as cores.'));reader.onload=()=>{const image=new Image();image.onerror=()=>reject(new Error('Não foi possível analisar esta imagem.'));image.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=72;canvas.height=72;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível analisar as cores da imagem.');ctx.drawImage(image,0,0,72,72);const pixels=ctx.getImageData(0,0,72,72).data;const bins=new Map<string,{r:number;g:number;b:number;n:number;score:number}>();for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<90)continue;const r=pixels[i],g=pixels[i+1],b=pixels[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=mx===0?0:(mx-mn)/mx;if(mx<35||(sat<.12&&mx>238))continue;const key=[Math.round(r/24)*24,Math.round(g/24)*24,Math.round(b/24)*24].join(',');const x=bins.get(key)||{r:0,g:0,b:0,n:0,score:0};x.r+=r;x.g+=g;x.b+=b;x.n++;x.score+=sat;bins.set(key,x);}const ranked=[...bins.values()].sort((a,b)=>b.n*(.55+b.score/Math.max(1,b.n))-a.n*(.55+a.score/Math.max(1,a.n)));const hex=(x:any)=>'#'+[x.r/x.n,x.g/x.n,x.b/x.n].map((v:number)=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');const hue=(x:any)=>{const r=x.r/x.n/255,g=x.g/x.n/255,b=x.b/x.n/255,m=Math.max(r,g,b),n=Math.min(r,g,b),d=m-n;if(!d)return 0;return ((m===r?(g-b)/d%6:m===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;};const primary=ranked[0]?hex(ranked[0]):'#247a42',h=ranked[0]?hue(ranked[0]):120,secondary=ranked.find(x=>Math.abs(((hue(x)-h+540)%360)-180)>32)||ranked[1];resolve({primary,button:primary,accent:secondary?hex(secondary):'#e9a52a',pageBackground:'#fffaf3',surface:'#ffffff',text:'#26352a'});}catch(e){reject(e);}};image.src=String(reader.result);};reader.readAsDataURL(file);});}
function readLogoPalette(value:any):LogoPalette|null{try{const p=typeof value==='string'?JSON.parse(value):value;if(!p||!['primary','button','accent','pageBackground','surface','text'].every(k=>/^#[0-9a-f]{6}$/i.test(p[k]||'')))return null;return p;}catch{return null;}}

function Storefront({slugOverride}:{slugOverride?:string}={}){const slug=slugOverride||useLocation().pathname.split('/')[2]||'';const[storeData,setStoreData]=useState<any>(null),[showSignup,setShowSignup]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[cat,setCat]=useState('all'),[cart,setCart]=useState<CartLine[]>([]),[pendingHalfAndHalf,setPendingHalfAndHalf]=useState<any>(null),[checkout,setCheckout]=useState(false),[placed,setPlaced]=useState<any>(null),[loading,setLoading]=useState(true),[mobileCart,setMobileCart]=useState(false);const navigate=useNavigate();
 useEffect(()=>{
  if(!storeData?.store?.name)return;
  document.title=storeData.store.name+' | Loja Online';
  return()=>{document.title='CR Jornada Express';};
 },[storeData?.store?.name]);
 const categoryListRef=useRef<HTMLDivElement>(null);
 const [canScrollCategoriesBack,setCanScrollCategoriesBack]=useState(false);
 const [canScrollCategoriesForward,setCanScrollCategoriesForward]=useState(false);
 function updateCategoryArrows(){
   const list=categoryListRef.current;
   if(!list)return;
   setCanScrollCategoriesBack(list.scrollLeft>3);
   setCanScrollCategoriesForward(list.scrollLeft+list.clientWidth<list.scrollWidth-3);
 }
 function moveCategories(direction:-1|1){
   const list=categoryListRef.current;
   if(!list)return;
   list.scrollBy({left:direction*Math.max(170,list.clientWidth*.72),behavior:'smooth'});
 }
 useEffect(()=>{let alive=true;async function refresh(){try{const status:StoreStatus=await req(`/store/${slug}/status`,{cache:'no-store'});if(alive)setStoreData((prev:any)=>prev?{...prev,store:{...prev.store,is_open:status.open?1:0,store_status:status}}:prev);}catch{}}const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[slug]);
 useEffect(()=>{setLoading(true);req(`/store/${slug}`).then((x:any)=>setStoreData({...x,store:{...x.store,neighborhoods:x.neighborhoods}})).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[slug]);
 useEffect(()=>{
   if(!storeData?.store?.signup_popup_enabled)return;
   let visible=true;
   try{
     const registered=localStorage.getItem(`crj_signup_registered_${slug}`)==='1';
     const dismissed=Number(localStorage.getItem(`crj_signup_dismissed_${slug}`)||0);
     visible=!registered&&(!dismissed||Date.now()-dismissed>7*24*60*60*1000);
   }catch{}
   setShowSignup(visible);
 },[storeData?.store?.id,slug]);
 function closeSignup(registered:boolean){
   setShowSignup(false);
   try{
     if(registered)localStorage.setItem(`crj_signup_registered_${slug}`,'1');
     else localStorage.setItem(`crj_signup_dismissed_${slug}`,String(Date.now()));
   }catch{}
 }
 const store=storeData?.store,products=storeData?.products||[],categories=storeData?.categories||[],neighborhoods=storeData?.neighborhoods||[];
 const shown=products.filter((p:any)=>(cat==='all'||p.category_id===cat)&&p.name.toLowerCase().includes(search.toLowerCase()));
 useEffect(()=>{
   const list=categoryListRef.current;
   if(!list)return;
   const update=()=>updateCategoryArrows();
   update();
   window.addEventListener('resize',update);
   // Após o carregamento da fonte / categorias, verificar novamente o tamanho.
   const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;
   if(observer){observer.observe(list);if(list.firstElementChild)observer.observe(list.firstElementChild);}
   return()=>{window.removeEventListener('resize',update);observer?.disconnect();};
 },[categories.length,loading]);
 const subtotal=cart.reduce((sum,line)=>sum+cartLineTotal(line),0);
 const cartItemCount=countCartItems(cart);
 const setLine=(product:any,variant:any,purchaseMode:PurchaseMode,quantity:number,customization?:CustomSelection)=>setCart(old=>{
   const targetKey=cartLineKey({product,variant,purchaseMode,quantity:1,customization});
   const next=old.filter(x=>cartLineKey(x)!==targetKey);
   if(Number.isSafeInteger(quantity)&&quantity>0)next.push({product,variant,purchaseMode,quantity,customization});
   return next;
 });
 const getLine=(product:any,variant:any,purchaseMode:PurchaseMode)=>cart.find(x=>cartLineKey(x)===cartLineKey({product,variant,purchaseMode,quantity:1}))?.quantity||0;
 const removeLine=(line:CartLine)=>setCart(old=>removeCartSelection(old,line));
 const startHalfAndHalf=(product:any,choice:CustomSelection,quantity:number)=>{setPendingHalfAndHalf({product,choice,quantity});window.scrollTo({top:0,behavior:'smooth'});};
 const finishHalfAndHalf=(secondProduct:any)=>{
  if(!pendingHalfAndHalf)return;
  const first=pendingHalfAndHalf.product;
  if(first.id===secondProduct.id){window.alert('Escolha um sabor diferente do primeiro.');return;}
  const firstConfig=readCustomConfig(first.custom_config_json)!;
  const secondConfig=readCustomConfig(secondProduct.custom_config_json)!;
  const firstSizeGroup=firstConfig.groups.find(g=>g.priceMode==='final');
  const selectedSize=firstSizeGroup?.options.find(o=>pendingHalfAndHalf.choice.optionIds.includes(o.id));
  const secondSizeGroup=secondConfig.groups.find(g=>g.priceMode==='final');
  const matchingSecondSize=selectedSize&&secondSizeGroup?.options.find(o=>o.name.trim().toLowerCase()===selectedSize.name.trim().toLowerCase());
  const secondFlavorPriceCents=matchingSecondSize?.priceCents??Number(secondProduct.price_cents||0);
  const choice:CustomSelection={...pendingHalfAndHalf.choice,pairedFlavorName:secondProduct.name,pairedFlavorPriceCents:secondFlavorPriceCents};
  const line:CartLine={product:first,purchaseMode:'unit',quantity:pendingHalfAndHalf.quantity,customization:choice};
  setCart(old=>{const key=cartLineKey(line);const existing=old.find(x=>cartLineKey(x)===key);return [...old.filter(x=>cartLineKey(x)!==key),{...line,quantity:line.quantity+(existing?.quantity||0)}];});
  setPendingHalfAndHalf(null);
 };
 if(loading)return <div className="loading"><span className="spinner"/>Carregando a loja…</div>;if(error||!store)return <div className="center-page"><h2>Não foi possível carregar esta loja</h2><p>{error}</p><button type="button" className="btn btn-primary" onClick={()=>window.location.reload()}>Tentar novamente</button></div>;
 const logoPalette=store.use_logo_colors?readLogoPalette(store.logo_palette_json):null;const storefrontColors=logoPalette?{'--store-color':logoPalette.primary,'--store-button':logoPalette.button,'--store-accent':logoPalette.accent,'--store-page-bg':logoPalette.pageBackground,'--store-surface':logoPalette.surface,'--store-text':logoPalette.text}:{'--store-color':store.primary_color||'#16834b','--store-button':store.button_color||store.primary_color||'#16834b','--store-accent':store.accent_color||'#ea580c','--store-page-bg':store.page_background_color||'#ffffff','--store-surface':store.surface_color||'#ffffff','--store-text':store.text_color||'#25372c'};return <div className={`storefront${cartItemCount>0?' has-mobile-cart-bar':''}`} style={storefrontColors as any}><div className="announcement"><ShoppingCart size={14}/> Ofertas e novidades da sua loja <span>•</span> Entrega no seu bairro</div><header className="store-header"><div className="store-logo"><span className="store-logo-icon">{store.logo_url?<img src={store.logo_url} alt={`Logomarca de ${store.name}`}/>:<Store size={24}/>}</span><span><b>{store.name}</b><small>Sua loja online</small></span></div><div className="store-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="O que você procura hoje?"/><kbd>⌘ K</kbd></div><div className="store-head-actions"><StoreShareButton storeName={store.name}/><a className="contact-link" href={`https://wa.me/${(store.whatsapp_public||'').replace(/\D/g,'')}`} target="_blank"><MessageCircle size={17}/><span>Fale conosco</span></a><button className="cart-head" onClick={()=>setMobileCart(true)}><ShoppingCart size={19}/><span className="cart-count" aria-label={`${cartItemCount} ${cartItemCount===1?'item':'itens'} no carrinho`}>{cartItemCount}</span></button></div></header>
 <main className="store-body"><StoreStatusNotice status={store.store_status||getStoreStatus(!!store.is_open,null)}/><StoreBannerCarousel store={store} banners={storeData?.banners||[]}/><div className="store-benefits"><span><Truck/> Entrega no mesmo dia</span><span><Check/> Pagamento na entrega</span><span><Clock/> {store.business_hours}</span></div><div className="catalog-layout" id="catalogo"><section className="catalog-main"><div className="catalog-heading"><div><span className="eyebrow">SUA LOJA, SUAS ESCOLHAS</span><h2>Escolha seus produtos</h2></div><span className="result-count">{shown.length} produtos disponíveis</span></div><div className="category-nav" aria-label="Categorias de produtos">
 <button type="button" className="category-nav-arrow" aria-label="Ver categorias anteriores"
   disabled={!canScrollCategoriesBack} onClick={()=>moveCategories(-1)}><ArrowLeft size={18}/></button>
 <div className="category-chips" ref={categoryListRef} onScroll={updateCategoryArrows}
   role="group" aria-label="Filtrar produtos por categoria">
   <button type="button" className={cat==='all'?'active':''} onClick={()=>setCat('all')}>Todos</button>
   {categories.map((c:any)=><button type="button" key={c.id} className={cat===c.id?'active':''}
     onClick={()=>setCat(c.id)}><span>{c.icon}</span>{c.name}</button>)}
 </div>
 <button type="button" className="category-nav-arrow" aria-label="Ver próximas categorias"
   disabled={!canScrollCategoriesForward} onClick={()=>moveCategories(1)}><ArrowRight size={18}/></button>
</div>{pendingHalfAndHalf&&<div className="custom-half-pending"><b>Escolha o segundo sabor da sua pizza</b><span>Primeiro sabor: {pendingHalfAndHalf.choice.optionIds.map((id:string)=>readCustomConfig(pendingHalfAndHalf.product.custom_config_json)?.groups.find(g=>g.selectionMode==='half-and-half')?.options.find(o=>o.id===id)?.name).filter(Boolean).join(', ')||pendingHalfAndHalf.product.name}</span><button type="button" className="btn btn-outline" onClick={()=>setPendingHalfAndHalf(null)}>Cancelar meio a meio</button></div>}{shown.length===0?<div className="empty-state"><Search size={28}/><b>Nenhum produto encontrado</b><p>Tente outra busca ou categoria.</p></div>:<div className="product-grid">{shown.map((p:any)=>p.custom_config_json?<CustomProductCard key={p.id} product={p} img={img} pendingSecondFlavor={!!pendingHalfAndHalf} onPickSecondFlavor={()=>finishHalfAndHalf(p)} onChooseSecondFlavor={(choice,qty)=>startHalfAndHalf(p,choice,qty)} onAdd={(choice,qty)=>setCart(old=>{const line:CartLine={product:p,purchaseMode:'unit',quantity:qty,customization:choice};const key=cartLineKey(line);const existing=old.find(x=>cartLineKey(x)===key);return [...old.filter(x=>cartLineKey(x)!==key),{...line,quantity:qty+(existing?.quantity||0)}];})}/>:p.fixed_options_enabled
 ?<FixedPriceProductCard key={p.id} p={p} getLine={getLine} setLine={setLine} img={img} money={money}/>
 :<ProductCard key={p.id} p={p} getLine={getLine} setLine={setLine}/>)}</div>}</section><aside className="cart-panel"><CartSummary cart={cart} subtotal={subtotal} store={store} onQty={setLine} onRemove={removeLine} onCheckout={()=>store.is_open&&cart.length&&setCheckout(true)}/></aside></div></main><footer className="store-footer"><div><b>{store.name}</b><span>{store.address_text}</span><span>{store.business_hours}</span></div><div><a href={store.instagram_url} target="_blank">Instagram</a><a href={`https://wa.me/${(store.whatsapp_public||'').replace(/\D/g,'')}`} target="_blank">WhatsApp</a></div></footer>
 {cartItemCount>0&&!mobileCart&&!checkout&&!placed&&!showSignup&&<MobileBagBar count={cartItemCount} subtotal={subtotal} onOpen={()=>setMobileCart(true)}/>}
 {showSignup&&<SignupPopup slug={slug} store={store} onDone={()=>closeSignup(true)} onClose={()=>closeSignup(false)}/>}
 {mobileCart&&<div className="modal-backdrop" onClick={()=>setMobileCart(false)}><div className="mobile-cart-drawer" onClick={e=>e.stopPropagation()}><button className="icon-btn drawer-close" onClick={()=>setMobileCart(false)}><X/></button><CartSummary cart={cart} subtotal={subtotal} store={store} onQty={setLine} onRemove={removeLine} onCheckout={()=>{setMobileCart(false);store.is_open&&cart.length&&setCheckout(true)}}/></div></div>}
 {checkout&&<CheckoutModal store={store} neighborhoods={neighborhoods} cart={cart} subtotal={subtotal} slug={slug} onClose={()=>setCheckout(false)} onSuccess={(o:any)=>{setPlaced(o);setCheckout(false);setCart([]);}}/>}{placed&&<div className="modal-backdrop"><div className="success-modal"><div className="success-icon"><Check size={36}/></div><span className="eyebrow">PEDIDO CONFIRMADO</span><h2>Está quase na sua porta!</h2><p>Seu pedido <b>#{placed.number}</b> foi recebido pela loja.</p><div className="success-total">Total a pagar na entrega <b>{money(placed.totalCents)}</b></div><Link className="btn btn-primary btn-block" to={`/pedido/${slug}/${placed.number}`} onClick={()=>setPlaced(null)}>Acompanhar pedido <ArrowRight size={17}/></Link><button className="btn btn-ghost btn-block" onClick={()=>{setPlaced(null);navigate(`/loja/${slug}`);}}>Voltar para início</button></div></div>}
 </div>;
}
function SignupPopup({slug,store,onClose,onDone}:any){
 const [form,setForm]=useState({name:'',email:'',phone:'',privacyAccepted:false,marketingOptIn:false,website:''});
 const [sending,setSending]=useState(false),[error,setError]=useState('');
 const set=(key:string,value:any)=>setForm(previous=>({...previous,[key]:value}));
 async function submit(e:any){
   e.preventDefault();setError('');
   if(!form.privacyAccepted){setError('É necessário autorizar o cadastro dos seus dados.');return;}
   setSending(true);
   try{
     await req(`/store/${encodeURIComponent(slug)}/signup`,{method:'POST',body:JSON.stringify(form)});
     onDone();
   }catch(err:any){setError(err.message||'Não foi possível concluir o cadastro.');}
   finally{setSending(false);}
 }
 return <div className="signup-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
   <section className="signup-dialog" role="dialog" aria-modal="true" aria-labelledby="signup-title">
     <button type="button" className="signup-close" aria-label="Fechar cadastro" onClick={onClose}><X size={22}/></button>
     <div className="signup-brand-graphic" aria-hidden="true">{store.signup_popup_emojis||'🛒 🍎 📦'}</div>
     <span className="signup-eyebrow">{store.signup_popup_eyebrow||'🛒 NOVIDADES DA SUA LOJA'}</span>
     <h2 id="signup-title">{store.signup_popup_title||'Novidades e ofertas em primeira mão!'}</h2>
     <p className="signup-description">{store.signup_popup_description||'Cadastre-se para conhecer as novidades e ofertas da nossa loja!'}</p>
     <form onSubmit={submit} className="signup-form">
       <label>Nome completo
         <input required autoComplete="name" minLength={3} maxLength={140} placeholder="Seu nome e sobrenome"
           value={form.name} onChange={e=>set('name',e.target.value)}/>
       </label>
       <label>E-mail
         <input type="email" required autoComplete="email" maxLength={200} placeholder="seuemail@exemplo.com"
           value={form.email} onChange={e=>set('email',e.target.value)}/>
       </label>
       <label>Celular com WhatsApp e DDD
         <input type="tel" required autoComplete="tel" inputMode="tel" placeholder="(73) 99999-9999"
           value={form.phone} onChange={e=>set('phone',e.target.value)}/>
       </label>
       <input className="signup-honeypot" aria-hidden="true" tabIndex={-1} autoComplete="off"
         value={form.website} onChange={e=>set('website',e.target.value)} name="website"/>
       <label className="signup-consent">
         <input type="checkbox" checked={form.privacyAccepted} onChange={e=>set('privacyAccepted',e.target.checked)} required/>
         <span>{store.signup_popup_privacy_consent||'Autorizo o cadastro de meus dados nesta loja para identificação e contato relacionado ao meu cadastro.'}</span>
       </label>
       <label className="signup-consent">
         <input type="checkbox" checked={form.marketingOptIn} onChange={e=>set('marketingOptIn',e.target.checked)}/>
         <span>{store.signup_popup_marketing_consent||'Quero receber novidades e ofertas por WhatsApp e e-mail (opcional).'}</span>
       </label>
       {error&&<div className="error-banner" role="alert">{error}</div>}
       <button className="btn btn-primary signup-submit" type="submit" disabled={sending}>
         {sending?'Cadastrando...':store.signup_popup_button||'Quero ficar por dentro!'} <ArrowRight size={17}/>
       </button>
       <p className="signup-privacy-note">{(store.signup_popup_privacy_note||'Seus dados ficam vinculados somente a {loja}. Você escolhe se quer receber novidades e pode solicitar atualização ou exclusão à loja.').replaceAll('{loja}',store.name)}</p>
     </form>
   </section>
 </div>;
}

function ProductCard({p,getLine,setLine}:any){
 const dual=productIsDual(p);
 const [variant,setVariant]=useState<any>(p.variants?.[0]);
 const [purchaseMode,setPurchaseMode]=useState<'weight'|'unit'>(p.sale_mode==='unit'?'unit':'weight');
 // Mantém o valor digitado como texto para permitir selecionar, apagar e reescrever sem forçar o mínimo a cada tecla.
 const [weightInput,setWeightInput]=useState(String(Number(p.min_qty)||100));
 const [unitInput,setUnitInput]=useState('1');
 const mode:PurchaseMode=p.sale_mode==='variants'?'variants':dual?purchaseMode:p.sale_mode;
 const current=mode==='variants'?variant||null:null;
 const selectedLine:CartLine={product:p,variant:current,purchaseMode:mode,quantity:1};
 const originalPrice=cartLineOriginalPrice(selectedLine);
 const price=cartLinePrice(selectedLine);
 const discountPercent=getDiscountPercent(originalPrice,price);
 const weightStep=Math.max(1,Number(p.step_qty)||50);
 const weightMin=Math.max(1,Number(p.min_qty)||100);
 const isWeight=mode==='weight';
 const quantityText=isWeight?weightInput:unitInput;
 const quantity=Number(quantityText);
 const validQuantity=quantityText.trim()!==''&&/^\d+$/.test(quantityText.trim())&&Number.isSafeInteger(quantity)&&quantity>0&&
   (isWeight?quantity>=weightMin&&quantity%weightStep===0:quantity>=1);
 // Evita calcular o preço com quantidade vazia ou inválida enquanto o usuário ainda está digitando.
 const total=validQuantity?calculateLineTotalCents(price,quantity,mode,p.pricing_unit_grams||1000):null;
 const unitDisabled=dual&&p.unit_available===0;
 const changeBy=(delta:number)=>{
   if(isWeight)setWeightInput(String(Math.max(weightMin,(Number.isSafeInteger(quantity)?quantity:0)+delta*weightStep)));
   else setUnitInput(String(Math.max(1,(Number.isSafeInteger(quantity)?quantity:0)+delta)));
 };
 const restoreEmpty=()=>{
   if(isWeight&&weightInput.trim()==='')setWeightInput(String(weightMin));
   if(!isWeight&&unitInput.trim()==='')setUnitInput('1');
 };
 return <article className="product-card">
  <div className="product-photo"><img src={img(p.image_url)} loading="lazy"/>
    {discountPercent!==null?<span className="product-discount-badge" aria-label={`Desconto de ${discountPercent} por cento`}>-{discountPercent}%</span>:<div className="fresh-pill"><span/> Fresco</div>}
    {p.is_featured?<span className="featured-tag">⭐ Destaque</span>:null}
  </div>
  <div className="product-info">
    <small className="product-category">{dual?'POR KG OU UNIDADE':mode==='weight'?'VENDIDO POR PESO':mode==='variants'?'EMBALAGENS':'UNIDADE'}</small>
    <h3>{p.name}</h3>{p.description&&<p className="product-desc">{p.description}</p>}
    {p.photo_source_url&&<small className="product-photo-credit">
     Foto: <a href={p.photo_source_url} target="_blank" rel="noopener noreferrer">
      {p.photo_author||'Wikimedia Commons'} · {p.photo_license||'Licença aberta'}
     </a>
    </small>}
    {dual&&<div className="purchase-mode-choices"><span>Como deseja comprar?</span><div className="purchase-mode-buttons">
      <button type="button" className={purchaseMode==='weight'?'selected':''} onClick={()=>setPurchaseMode('weight')}>Por kg</button>
      <button type="button" disabled={unitDisabled} className={purchaseMode==='unit'?'selected':''} onClick={()=>setPurchaseMode('unit')}>Por unidade</button>
    </div>{unitDisabled&&<small>Unidades temporariamente indisponíveis; venda por kg disponível.</small>}</div>}
    {mode==='variants'&&<select className="variant-select" value={variant?.id||''} onChange={e=>setVariant(p.variants.find((v:any)=>v.id===e.target.value))}>{p.variants.map((v:any)=><option key={v.id} value={v.id}>{v.name} — {money(v.promo_price_cents!=null&&v.promo_price_cents<v.price_cents?v.promo_price_cents:v.price_cents)}</option>)}</select>}
    <div className="product-price">
      <span className="current-price">{money(price)}</span>
      {discountPercent!==null&&<del className="previous-price" aria-label="Preço original">{money(originalPrice)}</del>}
      <small>/ {mode==='variants'?'embalagem':isWeight?'kg':'unidade'}</small>
    </div>
    <div className="weight-controls">
      <button type="button" aria-label="Diminuir quantidade" onClick={()=>changeBy(-1)}>−</button>
      <input
        aria-label={isWeight?'Quantidade em gramas':'Quantidade de unidades'}
        type="number" inputMode="numeric"
        min={isWeight?weightMin:1} step={isWeight?weightStep:1}
        value={quantityText}
        onChange={e=>isWeight?setWeightInput(e.target.value):setUnitInput(e.target.value)}
        onBlur={restoreEmpty}
      />
      <span>{isWeight?'g':'un'}</span>
      <button type="button" aria-label="Aumentar quantidade" onClick={()=>changeBy(1)}>+</button>
    </div>
    {!validQuantity&&<small className="quantity-help" role="status">{quantityText.trim()===''?'Digite a quantidade desejada.':isWeight?`Informe pelo menos ${weightMin} g, em incrementos de ${weightStep} g.`:'Informe uma quantidade inteira maior que zero.'}</small>}
    <button className="add-btn" type="button" disabled={!validQuantity||(mode==='unit'&&unitDisabled)}
      onClick={()=>{if(validQuantity)setLine(p,current,mode,getLine(p,current,mode)+quantity);}}>
      <Plus size={16}/> Adicionar
      <span>{validQuantity?(isWeight?formatWeightGrams(quantity)+' · ':quantity+' un · ')+money(total!):'—'}</span>
    </button>
  </div>
 </article>;
}
function CartSummary({cart,subtotal,store,onQty,onRemove,onCheckout}:any){
 const cartItemCount=countCartItems(cart);
 const [neighborhood,setNeighborhood]=useState('');
 const neighborhoods=store.neighborhoods||[];
 const fee=store.free_delivery_min_cents&&subtotal>=store.free_delivery_min_cents?0:(neighborhoods.find((x:any)=>x.name===neighborhood)?.delivery_fee_cents??store.default_delivery_fee_cents);
 return <div className="cart-box">
  <div className="cart-title"><div><span className="cart-title-icon"><ShoppingCart size={19}/></span><span><b>Seu carrinho</b><small>{cartItemCount} {cartItemCount===1?'item':'itens'} no carrinho</small></span></div><span className="cart-qty-pill" aria-label={`${cartItemCount} ${cartItemCount===1?'item':'itens'}`}>{cartItemCount}</span></div>
  {cart.length===0?<div className="cart-empty"><div>🛒</div><b>Seu carrinho está vazio</b><p>Adicione produtos para começar.</p></div>:<>
  <div className="cart-lines">{cart.map((line:CartLine)=>{
    const step=line.purchaseMode==='weight'?Number(line.product.step_qty||50):1;
    const minimum=line.purchaseMode==='weight'?Number(line.product.min_qty||100):1;
    const display=line.purchaseMode==='variants'?line.variant?.name:line.purchaseMode==='weight'?'Compra por kg':'Compra por unidade';
    const label= formatQuantityDisplay(line.quantity,line.purchaseMode,line.purchaseMode==='weight'?'kg':'un',line.variant?.name);
    return <div className="cart-line" key={cartLineKey(line)}><img src={img(line.product.image_url)}/><div className="cart-line-meta"><b>{line.product.name}</b><small>{display} · {label}</small>{line.customization&&<small className="customization-details">{resolveCustomSelection(readCustomConfig(line.product.custom_config_json)!,line.customization).details}</small>}<strong>{money(cartLineTotal(line))}</strong>
      <button type="button" className="cart-line-remove" aria-label={`Remover ${line.product.name} do carrinho`}
        onClick={()=>onRemove(line)}><Trash2 size={13} aria-hidden="true"/> Remover</button>
    </div><div className="cart-line-qty">
      <button type="button" onClick={()=>onQty(line.product,line.variant,line.purchaseMode,line.quantity-step,line.customization)}>−</button><span>{label}</span>
      <button type="button" onClick={()=>onQty(line.product,line.variant,line.purchaseMode,line.quantity+step,line.customization)}>+</button>
    </div></div>
  })}</div>
  <div className="delivery-select"><label>Bairro de entrega</label><select value={neighborhood} onChange={e=>setNeighborhood(e.target.value)}><option value="">Selecione seu bairro</option>{neighborhoods.map((n:any)=><option key={n.name} value={n.name}>{n.name}</option>)}</select></div>
  <div className="cart-calcs"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Entrega estimada</span><b>{fee===0?'Grátis':money(fee)}</b></div><div className="cart-total"><span>Total</span><b>{money(subtotal+fee)}</b></div></div>
  <LoyaltyNotice config={store.loyalty} subtotal={subtotal}/>
  <button className="btn btn-primary btn-block checkout-cta" disabled={!store.is_open} onClick={onCheckout}>{store.is_open?<>Finalizar pedido <ArrowRight size={17}/></>:'Loja fechada no momento'}</button>{!store.is_open&&<p className="store-closed-hint">{store.store_status?.label||'A loja não está recebendo pedidos.'}</p>}
  <p className="payment-hint"><ShieldCheck size={14}/> Pagamento feito somente na entrega</p></>}
 </div>;
}
function CheckoutModal({store,neighborhoods,cart,subtotal,slug,onClose,onSuccess}:any){const[form,setForm]=useState(()=>{const saved=loadCheckoutIdentity(slug);return {...saved,neighborhood:neighborhoods.some((n:any)=>n.name===saved.neighborhood)?saved.neighborhood:'',paymentMethod:store.accepts_cash?'cash':store.accepts_pix_delivery?'pix_delivery':store.accepts_debit_delivery?'debit_card':'credit_card',needsChange:false,changeFor:'',whatsappOptIn:false};});const[remember,setRemember]=useState(true);const[loading,setLoading]=useState(false),[error,setError]=useState('');const fee=store.free_delivery_min_cents&&subtotal>=store.free_delivery_min_cents?0:(neighborhoods.find((n:any)=>n.name===form.neighborhood)?.delivery_fee_cents??store.default_delivery_fee_cents);const total=subtotal+fee;const set=(k:string,v:any)=>setForm((f:any)=>({...f,[k]:v}));const enabled=[['cash','Dinheiro na entrega','accepts_cash'],['pix_delivery','Pix na entrega','accepts_pix_delivery'],['debit_card','Cartão de débito na entrega','accepts_debit_delivery'],['credit_card','Cartão de crédito na entrega','accepts_credit_delivery']].filter(([, ,key]:any)=>store[key]);async function submit(e:any){e.preventDefault();setError('');if(!store.is_open){setError('A loja está fechada no momento.');return;}setLoading(true);try{const result=await req(`/store/${slug}/orders`,{method:'POST',body:JSON.stringify({...form,items:cart.map((x:any)=>({productId:x.product.id,variantId:x.variant?.id,purchaseMode:x.purchaseMode==='variants'?undefined:x.purchaseMode,quantity:x.quantity,customization:x.customization}))})});if(remember)saveCheckoutIdentity(slug,form);else clearCheckoutIdentity(slug);onSuccess(result.order);}catch(e:any){setError(e.message);}finally{setLoading(false);}}return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="checkout-modal" onSubmit={submit}><div className="modal-heading"><div><span className="eyebrow">QUASE LÁ</span><h2>Finalizar pedido</h2><p>Entrega e pagamento combinados diretamente com a loja.</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><div className="checkout-scroll"><div className="form-section"><h3><Users size={17}/> Seus dados</h3><div className="form-grid"><label className="full">Nome completo<input required value={form.customerName} onChange={e=>set('customerName',e.target.value)} placeholder="Ex.: Maria Oliveira"/></label><label>WhatsApp<input required value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="(73) 99999-9999" inputMode="tel"/></label><label>Bairro<select required value={form.neighborhood} onChange={e=>set('neighborhood',e.target.value)}><option value="">Selecione</option>{neighborhoods.map((n:any)=><option key={n.name}>{n.name}</option>)}</select></label><label className="full">Rua / avenida<input required value={form.street} onChange={e=>set('street',e.target.value)}/></label><label>Número<input required value={form.number} onChange={e=>set('number',e.target.value)}/></label><label>Complemento<input value={form.complement} onChange={e=>set('complement',e.target.value)} placeholder="Apto, bloco…"/></label><label className="full">Referência (opcional)<input value={form.reference} onChange={e=>set('reference',e.target.value)} placeholder="Perto da praça…"/></label></div><label className="check-row"><input type="checkbox" checked={remember} onChange={e=>{setRemember(e.target.checked);if(!e.target.checked)clearCheckoutIdentity(slug);}}/> Salvar meus dados neste dispositivo para a próxima compra.</label><button type="button" className="btn btn-xs btn-outline" onClick={()=>{clearCheckoutIdentity(slug);setForm(f=>({...f,...emptyCheckoutIdentity()}));setRemember(false);}}>Limpar dados salvos</button></div><div className="form-section"><h3><WalletIcon/> Pagamento na entrega</h3><div className="payment-options">{enabled.map(([id,label]:any)=><label className={`payment-option ${form.paymentMethod===id?'selected':''}`} key={id}><input type="radio" name="pay" checked={form.paymentMethod===id} onChange={()=>set('paymentMethod',id)}/><span>{id==='cash'?'💵':id==='pix_delivery'?'📱':'💳'}</span>{label}</label>)}</div>{form.paymentMethod==='cash'&&<div className="change-question"><label className="check-row"><input type="checkbox" checked={form.needsChange} onChange={e=>set('needsChange',e.target.checked)}/> Precisa de troco?</label>{form.needsChange&&<label>Troco para quanto? (total {money(total)})<div className="money-input"><span>R$</span><input required value={form.changeFor} onChange={e=>set('changeFor',e.target.value)} placeholder="0,00" inputMode="decimal"/></div>{form.changeFor&&Number(String(form.changeFor).replace(',','.'))*100>=total&&<small className="change-result">Troco: {money(Math.round(Number(String(form.changeFor).replace(',','.'))*100)-total)}</small>}</label>}</div>}<label className="check-row opt-in"><input type="checkbox" checked={form.whatsappOptIn} onChange={e=>set('whatsappOptIn',e.target.checked)}/> Autorizo receber atualizações transacionais do pedido pelo WhatsApp.</label></div><LoyaltyNotice config={store.loyalty} subtotal={subtotal}/><div className="checkout-total"><span>Total a pagar na entrega</span><b>{money(total)}</b></div>{error&&<div className="error-banner">{error}</div>}</div><div className="checkout-foot"><button className="btn btn-primary btn-block" disabled={loading||!store.is_open}>{!store.is_open?'Loja fechada no momento':loading?<><span className="spinner small"/> Enviando pedido…</>:<>Confirmar pedido <ArrowRight size={17}/></>}</button><small>Ao confirmar, você concorda com o uso dos dados para processar esta compra.</small></div></form></div>}
function WalletIcon(){return <span>💳</span>}
function Tracking(){
 const [, , slug,orderNumber]=useLocation().pathname.split('/');
 const[data,setData]=useState<any>(null),[error,setError]=useState(''),
 [phone,setPhone]=useState(''),[loading,setLoading]=useState(false);
 async function refresh(){
   try{
     const latest=await req(`/store/${slug}/orders/${orderNumber}?phone=${encodeURIComponent(phone)}`);
     setData(latest);setError('');
   }catch(e:any){setError('Não foi possível atualizar agora. Tentaremos novamente.');}
 }
 useEffect(()=>{
   if(!data?.order?.id)return;
   const timer=setInterval(refresh,12000);
   return()=>clearInterval(timer);
 },[data?.order?.id,slug,orderNumber,phone]);
 async function find(e:any){
   e.preventDefault();setLoading(true);setError('');
   try{setData(await req(`/store/${slug}/orders/${orderNumber}?phone=${encodeURIComponent(phone)}`));}
   catch(e:any){setError(e.message);setData(null);}
   finally{setLoading(false);}
 }
 return <div className="track-page">
   <Link to={vanityStoreSlug(window.location.hostname)===slug?'/':`/loja/${slug}`} className="back-link"><ArrowLeft size={16}/> Voltar à loja</Link>
   {!data?<form className="track-card track-lookup" onSubmit={find}>
     <div className="success-icon"><ShieldCheck size={28}/></div>
     <span className="eyebrow">CONSULTA PRIVADA</span><h1>Pedido #{orderNumber}</h1>
     <p>Para proteger seus dados, informe o telefone usado na compra.</p>
     <label>Telefone / WhatsApp<input required value={phone}
       onChange={e=>setPhone(e.target.value)} placeholder="(73) 99999-9999" inputMode="tel"/></label>
     {error&&<div className="error-banner">{error}</div>}
     <button className="btn btn-primary btn-block" disabled={loading}>
       {loading?'Consultando…':'Acompanhar pedido'} <ArrowRight size={16}/>
     </button>
   </form>:<div className="track-card">
     <div className="success-icon"><Truck size={30}/></div>
     <span className="eyebrow">ACOMPANHAMENTO DO PEDIDO</span>
     <h1>Pedido #{data.order.order_number}</h1>
     <div className="status-chip">{ORDER_STATUS_LABELS[data.order.status as keyof typeof ORDER_STATUS_LABELS]||data.order.status}</div>
     <div className="track-steps">
       {['received','accepted','preparing','out_for_delivery','delivered']
        .map((st:string,i:number)=><div className={`track-step ${['received','accepted','preparing','out_for_delivery','delivered'].indexOf(data.order.status)>=i?'done':''}`} key={st}>
         <span>{i+1}</span><small>{ORDER_STATUS_LABELS[st as keyof typeof ORDER_STATUS_LABELS]}</small>
       </div>)}
     </div>
     {!!data.adjustments?.length&&<section className="track-adjustments">
       <h3>🧺 Seu pedido foi atualizado</h3>
       <p>O estabelecimento ajustou as quantidades. Confira as alterações e o valor final:</p>
       {data.adjustments.map((a:any)=><div className="track-adjustment" key={a.id}>
         <b>{a.reason}</b>
         <small>{new Date(a.created_at).toLocaleString('pt-BR')}</small>
         {(a.changes||[]).map((ch:any)=><span key={ch.itemId}>{ch.name}: {ch.from} → {ch.to}</span>)}
         <span>Antes: {money(a.old_total_cents)} · Depois: <strong>{money(a.new_total_cents)}</strong></span>
       </div>)}
     </section>}
     <div className="track-items">{data.items.map((i:any,idx:number)=><div key={idx}>
       <span>{i.product_name_snapshot}{i.variant_name_snapshot?` — ${i.variant_name_snapshot}`:''} · {i.quantity_display}{i.customization_snapshot&&<small className="customization-details">{i.customization_snapshot}</small>}</span>
       <b>{money(i.line_total_cents)}</b>
     </div>)}</div>
     <div className="checkout-total">
       <span>Total atualizado na entrega</span><b>{money(data.order.total_cents)}</b>
     </div>
     {error&&<div className="error-banner" role="alert">{error}</div>}
     <p className="track-refresh-note">Atualização automática a cada 12 segundos.</p>
     <button className="btn btn-ghost" onClick={()=>setData(null)}>Consultar outro pedido</button>
   </div>}
 </div>;
}

const menuItems:any[]=[['dashboard','Visão geral',LayoutDashboard],['orders','Pedidos',ClipboardList],['printing','Impressoras',Printer],['products','Produtos',Package],['categories','Categorias',Tags],['stock','Estoque',Box],['customers','Clientes',Users],['loyalty','Fidelidade',ShoppingBasket],['reports','Relatórios',BarChart3],['whatsapp','WhatsApp',MessageCircle],['settings','Configurações',Settings]];
function Admin(){const[auth,setAuth]=useState(localStorage.getItem('crj_token')||''),[user,setUser]=useState<any>(null),[active,setActive]=useState('dashboard'),[mobileOpen,setMobileOpen]=useState(false),[storeOpen,setStoreOpen]=useState(true);const adminNavigate=useNavigate();useEffect(()=>{if(auth){req('/auth/me',{},auth).then(x=>setUser(x.user)).catch(()=>{localStorage.removeItem('crj_token');setAuth('');});req('/admin/settings',{},auth).then(x=>setStoreOpen(x.storeStatus?.open??!!x.settings.is_open)).catch(()=>{});}},[auth]);useEffect(()=>{if(user?.role==='superadmin')adminNavigate('/superadmin');},[user]);useEffect(()=>{const h=(e:any)=>setStoreOpen(!!e.detail);window.addEventListener('store-status',h);return()=>window.removeEventListener('store-status',h);},[]);
useEffect(()=>{
 if(!mobileOpen)return;
 const closeOnEscape=(e:KeyboardEvent)=>{if(e.key==='Escape')setMobileOpen(false);};
 document.addEventListener('keydown',closeOnEscape);
 const previousOverflow=document.body.style.overflow;
 if(window.matchMedia('(max-width: 980px)').matches)document.body.style.overflow='hidden';
 return()=>{document.removeEventListener('keydown',closeOnEscape);document.body.style.overflow=previousOverflow;};
},[mobileOpen]);
if(!auth||!user)return <Login onLogin={(t:string,u:any)=>{localStorage.setItem('crj_token',t);setAuth(t);setUser(u);}}/>;const logout=()=>{localStorage.removeItem('crj_token');setAuth('');setUser(null);};return <div className="admin-shell">
 {mobileOpen&&<button type="button" className="admin-mobile-backdrop"
   onClick={()=>setMobileOpen(false)} aria-label="Fechar o menu lateral"/>}
 <aside className={`sidebar ${mobileOpen?'open':''}`}>
 <button type="button" className="sidebar-close" aria-label="Fechar menu" title="Fechar menu"
   onClick={()=>setMobileOpen(false)}><X size={21}/></button><Link to="/" className="admin-brand"><span className="brand-mark"><Store/></span><span>CR Jornada<small>EXPRESS</small></span></Link><div className="sidebar-tenant"><span className="tenant-avatar">{user.tenantName?.[0]||'C'}</span><span><b>{user.tenantName||'Central CR Jornada'}</b><small>{user.role==='superadmin'?'Super Administrador':'Plano Profissional'}</small></span><ChevronDown size={15}/></div><nav className="admin-menu"><small className="menu-label">MENU PRINCIPAL</small>{menuItems.map(([id,label,Icon])=><button key={id} className={active===id?'active':''} onClick={()=>{setActive(id);setMobileOpen(false);}}><Icon size={18}/><span>{label}</span>{id==='orders'&&<em className="menu-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-help"><span>🌱</span><b>Precisa de ajuda?</b><small>Fale com o suporte CR Jornada.</small></div><button className="profile-mini" onClick={logout}><span className="profile-avatar">{user.name?.[0]}</span><span><b>{user.name}</b><small>{user.email}</small></span><LogOut size={17}/></button></div></aside><main className="admin-main"><header className="admin-topbar"><button type="button" className="icon-btn mobile-menu-btn" aria-label={mobileOpen?"Fechar menu":"Abrir menu"} aria-expanded={mobileOpen} onClick={()=>setMobileOpen(!mobileOpen)}>{mobileOpen?<X/>:<Menu/>}</button><div className="breadcrumbs"><span>Painel</span><ChevronDown size={14}/><b>{menuItems.find(x=>x[0]===active)?.[1]}</b></div><div className="topbar-right"><span className={`open-indicator ${storeOpen?'':'closed'}`}><i/> {storeOpen?'Loja aberta':'Loja fechada'}</span><a className="btn btn-sm btn-outline" href={storeHomeUrl(user.tenantSlug||'verde-vivo')} target="_blank" rel="noopener noreferrer"><Eye size={15}/> Ver loja</a><button className="icon-btn notification-btn"><MessageCircle size={18}/></button><span className="profile-avatar top-avatar">{user.name?.[0]}</span></div></header><div className="admin-content">{active==='dashboard'?<Dashboard token={auth} user={user}/>:active==='orders'?<Orders token={auth} user={user}/>:active==='printing'?<PrintingPanel token={auth} user={user}/>:active==='products'?<Products token={auth}/>:active==='categories'?<Categories token={auth}/>:active==='stock'?<Stock token={auth}/>:active==='customers'?<Customers token={auth}/>:active==='loyalty'?<LoyaltyPanel request={(path,options)=>req(path,options,auth)}/>:active==='reports'?<Reports token={auth}/>:active==='whatsapp'?<WhatsApp token={auth}/>:<SettingsPanel token={auth} user={user}/>}</div></main></div>}
function Login({onLogin}:any){const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[show,setShow]=useState(false);async function submit(e:any){e.preventDefault();setLoading(true);setError('');try{const x=await req('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(x.token,x.user);}catch(e:any){setError(e.message);}finally{setLoading(false);}}return <div className="login-screen"><Link to="/" className="login-back"><ArrowLeft size={16}/> Página inicial</Link><div className="login-visual"><div className="login-illustration"><div className="login-express-art"><div className="login-express-icon"><Store size={72}/></div><div className="login-express-products"><span>🥬</span><span>🛒</span><span>🍚</span><span>🍎</span></div></div><div className="login-quote"><ShoppingCart/><b>Seu comércio merece<br/>vender mais.</b><small>CR Jornada Express · Sua loja digital</small></div></div></div><div className="login-form-side"><form className="login-card" onSubmit={submit}><div className="login-logo"><span className="brand-mark"><Store/></span><span>CR Jornada<small> EXPRESS</small></span></div><span className="eyebrow">BEM-VINDO DE VOLTA</span><h1>Acesse seu painel</h1><p>Gerencie sua loja com praticidade.</p><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Senha<div className="password-input"><input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required/><button type="button" onClick={()=>setShow(!show)}>{show?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>{error&&<div className="error-banner">{error}</div>}<button className="btn btn-primary btn-block login-submit" disabled={loading}>{loading?'Entrando…':'Entrar no painel'} <ArrowRight size={17}/></button><div className="demo-login"><ShieldCheck size={15}/><span>Acesso reservado aos administradores da loja.</span></div></form></div></div>}
function PageHead({eyebrow,title,desc,action}:any){return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{desc&&<p>{desc}</p>}</div>{action}</div>}
function Dashboard({token,user}:any){const[data,setData]=useState<any>(null),[error,setError]=useState('');useEffect(()=>{req('/admin/dashboard',{},token).then(setData).catch(e=>setError(e.message));},[]);return <><PageHead eyebrow={`OLÁ, ${user.name?.split(' ')[0]?.toUpperCase()||'LOJISTA'} 👋`} title="Sua loja em um olhar" desc="Acompanhe os pedidos e o movimento de hoje." action={<button className="btn btn-outline" onClick={()=>location.reload()}><RefreshCw size={16}/> Atualizar</button>}/>{error&&<div className="error-banner">{error}</div>}<div className="stats-grid">{[[ClipboardList,'Pedidos hoje',data?.today?.orders||0,'primary'],[BarChart3,'Vendas hoje',money(data?.today?.sales||0),'orange'],[Clock,'Aguardando aceite',data?.counts?.received||0,'blue'],[Truck,'Em entrega',data?.counts?.out_for_delivery||0,'purple']].map(([Icon,label,value,color]:any)=><div className="stat-card" key={label}><div className={`stat-icon ${color}`}><Icon size={20}/></div><div><small>{label}</small><b>{value}</b></div><span className="stat-spark">↗</span></div>)}</div><div className="dashboard-grid"><section className="panel-card recent-panel"><div className="panel-heading"><div><h2>Pedidos recentes</h2><p>Os últimos pedidos da sua loja</p></div><button className="text-link-btn" onClick={()=>window.dispatchEvent(new CustomEvent('nav',{detail:'orders'}))}>Ver todos <ArrowRight size={14}/></button></div><div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Status</th><th>Total</th></tr></thead><tbody>{(data?.recentOrders||[]).map((o:any)=><tr key={o.id}><td><b>#{o.order_number}</b></td><td>{o.customer_name}</td><td>{new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td><StatusBadge status={o.status}/></td><td><b>{money(o.total_cents)}</b></td></tr>)}</tbody></table>{!data?.recentOrders?.length&&<div className="empty-table">Nenhum pedido por enquanto.</div>}</div></section><section className="panel-card lowstock-panel"><div className="panel-heading"><div><h2>Estoque baixo</h2><p>Produtos que precisam de atenção</p></div><Box size={18}/></div>{(data?.lowStock||[]).map((p:any)=><div className="lowstock-row" key={p.id}><span className="lowstock-img">🥬</span><span><b>{p.name}</b><small>{p.physical_qty-p.reserved_qty} {p.unit_label} disponíveis</small></span><span className="lowstock-alert">Baixo</span></div>)}{!data?.lowStock?.length&&<div className="positive-state"><Check/> Estoque em dia. Bom trabalho!</div>}</section></div><div className="quick-actions"><span>Acesso rápido</span><button onClick={()=>window.dispatchEvent(new CustomEvent('nav',{detail:'products'}))}><Plus/> Novo produto</button><button onClick={()=>window.dispatchEvent(new CustomEvent('nav',{detail:'orders'}))}><ClipboardList/> Ver pedidos</button><button onClick={()=>window.dispatchEvent(new CustomEvent('nav',{detail:'whatsapp'}))}><MessageCircle/> Conectar WhatsApp</button></div><NavEvents/></>}
function NavEvents(){const nav=(e:any)=>{const btn=[...document.querySelectorAll('.admin-menu button')].find((x:any)=>x.textContent?.toLowerCase().includes(e.detail==='products'?'produtos':e.detail==='orders'?'pedidos':'whatsapp')) as HTMLButtonElement;btn?.click();};useEffect(()=>{window.addEventListener('nav',nav);return()=>window.removeEventListener('nav',nav);},[]);return null}
function StatusBadge({status}:any){const cl={received:'yellow',accepted:'blue',preparing:'purple',out_for_delivery:'orange',delivered:'green',cancelled:'gray'}[status as string]||'gray';return <span className={`status-badge ${cl}`}><i/>{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]||status}</span>}
function Orders({token,user}:any){
 const[data,setData]=useState<any[]>([]),[filter,setFilter]=useState('all');
 const[selected,setSelected]=useState<any>(null),[error,setError]=useState('');
 const[busy,setBusy]=useState(''),[editing,setEditing]=useState(false);
 const[draft,setDraft]=useState<Record<string,string>>({}),[outOfStock,setOutOfStock]=useState<Record<string,boolean>>({}),[reason,setReason]=useState('');
 const[notice,setNotice]=useState(''),[success,setSuccess]=useState('');
 const[printTarget,setPrintTarget]=useState<any>(null);
 const[receiptFooter,setReceiptFooter]=useState('');
 const[receiptLogoUrl,setReceiptLogoUrl]=useState<string|null>(null);
  const[receiptWatermark,setReceiptWatermark]=useState<any>({text:'',orientation:'diagonal',opacity:10,fontSize:21});
 // Monta a comanda antes de chamar window.print, sem popup e sem aplicativo auxiliar.
 function printOrder(order:any){
  if(!order)return;
  flushSync(()=>setPrintTarget(order));
  window.print();
 }
 async function load(selectedId?:string){
   try{
     const x=await req('/admin/orders',{},token),orders=x.orders||[];
     setData(orders);setReceiptFooter(x.receiptFooter||'');setReceiptLogoUrl(x.receiptLogoUrl||null);setReceiptWatermark(x.receiptWatermark||{text:'',orientation:'diagonal',opacity:10,fontSize:21});
     if(x.receiptLogoUrl){const preload=new Image();preload.src=x.receiptLogoUrl;}
     if(selectedId)setSelected(orders.find((o:any)=>o.id===selectedId)||null);
     return orders;
   }catch(e:any){setError(e.message);return [];}
 }
 useEffect(()=>{load();},[token]);
 function openOrder(o:any){setSelected(o);setEditing(false);setDraft({});setOutOfStock({});setReason('');setNotice('');setError('');}
 function closeOrder(){if(!busy){setSelected(null);setEditing(false);setNotice('');}}
 function startEditing(){
   if(!selected)return;
   setDraft(Object.fromEntries((selected.items||[]).map((i:any)=>[i.id,String(i.quantity)])));
   setReason('');setOutOfStock({});setNotice('');setEditing(true);
 }
 function numberFor(i:any):number{
   const value=draft[i.id]??String(i.quantity);
   return value.trim()===''?NaN:Number(value);
 }
 const changes=editing&&selected?(selected.items||[]).filter((i:any)=>numberFor(i)!==Number(i.quantity)):[];
 const invalid=changes.some((i:any)=>{
   const q=numberFor(i);
   return !Number.isSafeInteger(q)||q<0||q>i.quantity||
    (q>0 && !Number.isInteger((i.stock_deducted_qty||0)*q/i.quantity));
 });
 const previewSubtotal=editing&&selected?
   (selected.items||[]).reduce((sum:number,i:any)=>{
     const q=numberFor(i);
     if(!Number.isSafeInteger(q)||q<0)return sum;
     return sum+Math.round(i.line_total_cents*q/i.quantity);
   },0):0;
 const previewTotal=selected?previewSubtotal+selected.delivery_fee_cents:0;
 async function change(o:any,status:string){
   setBusy(o.id);setError('');setNotice('');
   try{
     await req(`/admin/orders/${o.id}/status`,{method:'PATCH',
       body:JSON.stringify({status,reason:'Cancelado pelo estabelecimento'})},token);
     await load();setSelected(null);setEditing(false);
   }catch(e:any){setError(e.message);}finally{setBusy('');}
 }
 async function removeOrder(o:any){
   if(busy||o.status!=='cancelled')return;
   const confirmed=window.confirm(
     `Remover o pedido #${o.order_number} de todas as listas e indicadores?\n\nO cadastro do cliente será preservado. O pedido cancelado continuará no histórico interno de auditoria.`
   );
   if(!confirmed)return;
   setBusy(o.id);setError('');setSuccess('');
   try{
     await req(`/admin/orders/${o.id}`,{method:'DELETE'},token);
     setSelected(null);setEditing(false);
     await load();
     setSuccess(`Pedido #${o.order_number} removido das listas. O cliente continua cadastrado.`);
   }catch(e:any){setError(e.message||'Não foi possível remover o pedido.');}
   finally{setBusy('');}
 }
 async function saveItems(){
   if(!selected||busy)return;
   setError('');setNotice('');
   if(invalid||!changes.length){setError('Informe uma redução válida em pelo menos um produto.');return;}
   if(reason.trim().length<5){setError('Informe o motivo da alteração para o cliente.');return;}
   if((selected.items||[]).every((i:any)=>numberFor(i)===0)){
     setError('Para retirar todos os produtos, utilize Cancelar pedido.');return;
   }
   setBusy(selected.id);
   try{
     const response=await req(`/admin/orders/${selected.id}/items`,{
       method:'PATCH',body:JSON.stringify({
         expectedVersion:Number(selected.adjustment_version||0),
         reason:reason.trim(),
         updates:changes.map((i:any)=>({itemId:i.id,quantity:numberFor(i),markOutOfStock:numberFor(i)===0&&!!outOfStock[i.id]}))
       })
     },token);
     setEditing(false);setDraft({});setOutOfStock({});setReason('');
     await load(selected.id);
     setNotice(response.notificationStatus==='sent'
       ?'Pedido atualizado! A Evolution aceitou a notificação enviada ao cliente.'
       :response.notificationStatus==='skipped_no_optin'
       ?'Pedido atualizado! O cliente não autorizou avisos por WhatsApp; ele verá o novo total no acompanhamento.'
       :'Pedido atualizado! O aviso ao cliente está na fila do WhatsApp e poderá ser consultado no Histórico de envios.');
   }catch(e:any){setError(e.message||'Falha ao salvar alterações.');}
   finally{setBusy('');}
 }
 const filtered=filter==='all'?data:data.filter(o=>o.status===filter);
 const canEdit=selected&&selected.stock_state==='reserved'&&
   ['received','accepted','preparing'].includes(selected.status);
 return <>
   <PageHead eyebrow="OPERAÇÃO DA LOJA" title="Pedidos"
     desc="Acompanhe, aceite, edite quantidades e atualize cada pedido."
     action={<button className="btn btn-outline" onClick={()=>load()}>
       <RefreshCw size={16}/> Atualizar</button>}/>
   {error&&!selected&&<div className="error-banner">{error}</div>}{success&&<div className="order-removed-message" role="status">{success}</div>}
   <div className="filter-row"><div className="filter-scroll">
     {([['all','Todos'],['received','Recebidos'],['accepted','Aceitos'],['preparing','Preparação'],
       ['out_for_delivery','Em entrega'],['delivered','Entregues'],['cancelled','Cancelados']] as string[][])
       .map(([id,label])=><button className={filter===id?'active':''}
         onClick={()=>setFilter(id)} key={id}>{label}{id==='all'&&<small>{data.length}</small>}</button>)}
   </div></div>
   <div className="panel-card"><div className="table-wrap orders-table"><table>
     <thead><tr><th>Pedido</th><th>Cliente</th><th>Data e hora</th><th>Pagamento</th>
       <th>Status</th><th>Total</th><th></th></tr></thead>
     <tbody>{filtered.map(o=><tr key={o.id}>
       <td><b>#{o.order_number}</b></td>
       <td><b>{o.customer_name}</b><small className="cell-sub">{o.customer_phone}</small></td>
       <td>{new Date(o.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</td>
       <td>{PAYMENT_METHOD_LABELS[o.payment_method as keyof typeof PAYMENT_METHOD_LABELS]}</td>
       <td><StatusBadge status={o.status}/></td>
       <td><b>{money(o.total_cents)}</b></td>
       <td><div className="order-row-buttons">
        <button className="btn btn-xs btn-outline" onClick={()=>openOrder(o)}>Detalhes</button>
         <button type="button" className="btn btn-xs btn-outline"
           aria-label={`Imprimir pedido #${o.order_number}`} onClick={()=>printOrder(o)}>
           <Printer size={14}/> Imprimir
         </button>
        {o.status==='cancelled'&&<button className="order-trash-button" type="button"
          disabled={!!busy} aria-label={`Remover pedido #${o.order_number} da lista`}
          title="Remover pedido cancelado" onClick={()=>removeOrder(o)}>
          <Trash2 size={15}/>
        </button>}
       </div></td>
     </tr>)}</tbody>
   </table>{!filtered.length&&<div className="empty-table">Nenhum pedido nesta etapa.</div>}</div></div>
   {selected&&<div className="modal-backdrop" onClick={closeOrder}>
     <div className="order-modal" onClick={e=>e.stopPropagation()}>
       <div className="modal-heading"><div>
         <span className="eyebrow">DETALHES DO PEDIDO</span>
         <h2>Pedido #{selected.order_number}</h2>
       </div><button className="icon-btn" aria-label="Fechar pedido" onClick={closeOrder}><X/></button></div>
       <div className="order-customer">
         <span className="profile-avatar">{selected.customer_name[0]}</span>
         <span><b>{selected.customer_name}</b><small>{selected.customer_phone}</small></span>
         <a className="btn btn-xs btn-soft" href={`https://wa.me/${selected.customer_phone}`}
           target="_blank" rel="noopener noreferrer"><MessageCircle size={14}/> WhatsApp</a>
       </div>
       <div className="order-address"><MapPin size={17}/><span>
         {selected.address_street}, {selected.address_number} · {selected.address_neighborhood}
         {selected.address_complement&&`, ${selected.address_complement}`}
         {selected.address_reference&&` · Ref: ${selected.address_reference}`}
       </span></div>
       {error&&<div className="error-banner order-inline-alert" role="alert">{error}</div>}
       {notice&&<p className="order-edit-notice" role="status">{notice}</p>}
       <div className="order-edit-header"><h3>Produtos do pedido</h3>
         {canEdit&&!editing&&<button className="btn btn-xs btn-outline" type="button"
           disabled={!!busy} onClick={startEditing}>Editar itens</button>}
       </div>
       {editing&&<p className="order-edit-help">Reduza ou retire o que estiver em falta.
         O preço será atualizado automaticamente. A edição não adiciona novos produtos.</p>}
       <div className="order-items-list">
         {(selected.items||[]).map((i:any,idx:number)=>{
           const q=editing?numberFor(i):i.quantity;
           const changed=editing&&q!==i.quantity;
           const lineTotal=changed&&Number.isSafeInteger(q)&&q>=0?
             Math.round(i.line_total_cents*q/i.quantity):i.line_total_cents;
           return <div key={i.id||idx} className={changed?'order-item-changed':''}>
             <span><b>{i.product_name_snapshot}
               {i.variant_name_snapshot&&` — ${i.variant_name_snapshot}`}</b>
               <small>{i.quantity_display} · {money(i.unit_price_cents)}
                 {i.sale_mode==='weight'?' / kg':' / un'}</small>{i.customization_snapshot&&<small className="customization-details">{i.customization_snapshot}</small>}
               {editing&&<div className="order-edit-line">
                 <label>Nova quantidade
                   <span className="order-edit-qty">
                     <input aria-label={`Nova quantidade de ${i.product_name_snapshot}`}
                       type="number" inputMode="numeric" min="0" step="1"
                       max={i.quantity} value={draft[i.id]??String(i.quantity)}
                       onChange={e=>setDraft(d=>({...d,[i.id]:e.target.value}))}/>
                     <em>{i.sale_mode==='weight'?'g':'un'}</em>
                   </span>
                 </label>
                 <button type="button" className="order-remove-line"
                   onClick={()=>setDraft(d=>({...d,[i.id]:q===0?String(i.quantity):'0'}))}>
                   {q===0?'Restaurar':'Retirar item'}
                 </button>
               </div>}
               {editing&&q===0&&<label className="order-outofstock-checkbox">
                 <input type="checkbox" checked={!!outOfStock[i.id]}
                   onChange={e=>setOutOfStock(o=>({...o,[i.id]:e.target.checked}))}/>
                 <span>Marcar como esgotado na vitrine (zerar estoque disponível para novas vendas)</span>
               </label>}
               {editing&&changed&&<small className="order-edit-difference">
                 {q===0?'Produto retirado':Number.isSafeInteger(q)&&q>0?
                   `Novo valor: ${money(lineTotal)}`:'Confira a quantidade'}
               </small>}
             </span><b>{money(lineTotal)}</b>
           </div>;
         })}
       </div>
       {editing&&<div className="order-edit-reason">
         <label>Motivo da alteração (será informado ao cliente)
           <textarea required minLength={5} maxLength={240} rows={2}
             value={reason} placeholder="Ex.: Não temos a quantidade solicitada de banana."
             onChange={e=>setReason(e.target.value)}/>
         </label>
         <small>{selected.whatsapp_opt_in?
           'Se o WhatsApp estiver conectado, o cliente receberá o resumo e o novo total automaticamente.':
           'O cliente não autorizou WhatsApp. Ele poderá consultar a alteração pelo acompanhamento do pedido.'}</small>
         <div className="order-edit-preview">
           <span>Total anterior <s>{money(selected.total_cents)}</s></span>
           <strong>Novo total previsto: {invalid?'Confira os valores':money(previewTotal)}</strong>
           <small>Taxa de entrega mantida: {money(selected.delivery_fee_cents)}</small>
         </div>
       </div>}
       <div className="order-payment">
         <div><span>Pagamento</span><b>{PAYMENT_METHOD_LABELS[selected.payment_method as keyof typeof PAYMENT_METHOD_LABELS]}</b></div>
         {selected.needs_change&&<div><span>Troco para / devolver</span>
           <b>{money(selected.change_for_cents)} / {money(selected.change_amount_cents)}</b></div>}
         <div><span>Subtotal + entrega</span>
           <b>{money(selected.subtotal_cents)} + {money(selected.delivery_fee_cents)}</b></div>
         <div className="order-total"><span>Total</span><b>{money(selected.total_cents)}</b></div>
       </div>
       {!!selected.adjustments?.length&&<div className="order-edit-history">
         <h3>Histórico de alterações</h3>
         {selected.adjustments.map((a:any)=><div key={a.id}>
           <b>{new Date(a.created_at).toLocaleString('pt-BR')} · {a.reason}</b>
           {(a.changes||[]).map((c:any)=><small key={c.itemId}>
             {c.name}: {c.from} → {c.to}</small>)}
           <small>Total: {money(a.old_total_cents)} → {money(a.new_total_cents)}</small>
         </div>)}
       </div>}
       <div className="order-actions">
         {!editing&&<button type="button" className="btn btn-outline"
           disabled={!!busy} onClick={()=>printOrder(selected)}>
           <Printer size={16}/> Imprimir
         </button>}
         {!editing&&selected.status==='cancelled'&&<button className="btn btn-danger-soft"
           disabled={!!busy} onClick={()=>removeOrder(selected)}>
           <Trash2 size={15}/> Remover pedido da lista
         </button>}
         {editing?<><button className="btn btn-outline" disabled={!!busy}
           onClick={()=>{setEditing(false);setError('');}}>Voltar</button>
           <button className="btn btn-primary" disabled={!!busy||invalid||!changes.length}
             onClick={saveItems}>{busy?'Salvando…':'Salvar e avisar cliente'}</button></>:
         selected.status!=='delivered'&&selected.status!=='cancelled'&&<>
           <button className="btn btn-danger-soft" disabled={!!busy}
             onClick={()=>change(selected,'cancelled')}>Cancelar</button>
           <button className="btn btn-primary" disabled={!!busy}
             onClick={()=>change(selected,({received:'accepted',accepted:'preparing',
               preparing:'out_for_delivery',out_for_delivery:'delivered'} as any)[selected.status])}>
             {busy?'Salvando…':({received:'Aceitar pedido',accepted:'Em preparação',
               preparing:'Saiu para entrega',out_for_delivery:'Marcar como entregue'} as any)[selected.status]}
           </button></>}
       </div>
     </div>
   </div>}
   {printTarget&&createPortal(<OrderPrintReceipt order={printTarget}
     storeName={user?.tenantName||'Hortifruti'} footerMessage={receiptFooter} storeLogoUrl={receiptLogoUrl}
      watermarkText={receiptWatermark.text} watermarkOrientation={receiptWatermark.orientation}
      watermarkOpacity={receiptWatermark.opacity} watermarkFontSize={receiptWatermark.fontSize}/>,document.body)}
 </>;
}
function Products({token}:any){const[items,setItems]=useState<any[]>([]),[categories,setCategories]=useState<any[]>([]),[saleModes,setSaleModes]=useState<string[]>([]),[saleModesLoaded,setSaleModesLoaded]=useState(false),[modal,setModal]=useState(false),[editing,setEditing]=useState<any>(null),[error,setError]=useState(''),[photoSuggestions,setPhotoSuggestions]=useState<any[]>([]),[findingPhotos,setFindingPhotos]=useState(false),[photoMessage,setPhotoMessage]=useState(''),[uploadingPhoto,setUploadingPhoto]=useState(false),[backfilling,setBackfilling]=useState(false),[photoBatchNotice,setPhotoBatchNotice]=useState(''),[form,setForm]=useState<any>({name:'',saleMode:'weight',ean:'',unitLabel:'kg',price:'',promoPrice:'',unitPrice:'',unitWeightGrams:'',stock:'',categoryId:'',minQty:100,stepQty:50,sharedPool:true,poolStock:360,variants:[{name:'Cartela com 30 ovos',sku:'',price:'23,90',promoPrice:'',deductionQty:30},{name:'Dúzia (12 ovos)',sku:'',price:'10,90',promoPrice:'',deductionQty:12},{name:'Meia dúzia (6 ovos)',sku:'',price:'5,90',promoPrice:'',deductionQty:6}]});async function load(){const z=await req('/admin/sales-modes',{},token);const enabled=Array.isArray(z.saleModes)?z.saleModes.filter((m:string)=>['weight','unit','dual','variants','custom','pizzeria'].includes(m)):[];setSaleModes(enabled);setSaleModesLoaded(true);const[x,y]=await Promise.all([req('/admin/products',{},token),req('/admin/categories',{},token)]);setItems(x.products);setCategories(y.categories);}useEffect(()=>{load().catch(e=>{setSaleModes([]);setSaleModesLoaded(true);setError(e.message||'Não foi possível carregar as modalidades autorizadas para esta loja.');});},[token]);function openEdit(p:any){setPhotoSuggestions([]);setPhotoMessage('');setEditing(p);setForm({name:p.name,saleMode:p.custom_config_json?'custom':p.fixed_options_enabled?'fixed':productIsDual(p)?'dual':p.sale_mode,ean:p.ean||'',customConfig:readCustomConfig(p.custom_config_json)||newCustomConfig(),halfAndHalf:!!readCustomConfig(p.custom_config_json)?.groups.some((g:any)=>g.selectionMode==='half-and-half'),unitLabel:p.unit_label,unitPrice:p.unit_price_cents!=null?(p.unit_price_cents/100).toFixed(2).replace('.',','):'',unitWeightGrams:p.unit_weight_grams||'',price:(Number(p.price_cents||0)/100).toFixed(2).replace('.',','),promoPrice:p.promo_price_cents?(Number(p.promo_price_cents)/100).toFixed(2).replace('.',','):'',stock:p.sale_mode==='weight'?Number(p.physical_qty||0)/1000:p.physical_qty,categoryId:p.category_id||'',minQty:p.min_qty,stepQty:p.step_qty,featured:!!p.is_featured,description:p.description||'',imageUrl:p.image_url||'',sharedPool:!!p.variants?.[0]?.stock_pool_id,poolStock:p.fixed_options_enabled?(Number(p.variants?.[0]?.pool_physical_qty||0)/1000):(p.variants?.[0]?.pool_physical_qty||0),variants:(p.variants||[]).map((v:any)=>({...v,price:(Number(v.price_cents)/100).toFixed(2).replace('.',','),promoPrice:v.promo_price_cents?(Number(v.promo_price_cents)/100).toFixed(2).replace('.',','):'',deductionQty:v.pool_deduction_qty,stockQty:v.physical_qty}))});setError('');setModal(true);}
useEffect(()=>{
 if(!modal||!form.name?.trim()||form.name.trim().length<2){setPhotoSuggestions([]);return;}
 let active=true;
 setPhotoSuggestions([]);
 const timeout=setTimeout(()=>{
  req('/admin/products/image-suggestions?name='+encodeURIComponent(form.name.trim())+'&external=0',{},token)
  .then((result:any)=>{if(active)setPhotoSuggestions(result.suggestions||[]);})
  .catch(()=>{if(active)setPhotoSuggestions([]);});
 },380);
 return()=>{active=false;clearTimeout(timeout);};
},[modal,form.name,token]);
async function fillMissingImages(){
 setBackfilling(true);setPhotoBatchNotice('');setError('');
 try{
  const result=await req('/admin/products/images/autofill',{method:'POST',body:'{}'},token);
  setPhotoBatchNotice(result.message+' Verificados: '+result.checked+'.');
  await load();
 }catch(e:any){setError(e.message||'Falha ao procurar imagens.');}
 finally{setBackfilling(false);}
}
async function searchProductPhotos(){
 if(!form.name?.trim()){setPhotoMessage('Informe o nome do produto.');return;}
 setFindingPhotos(true);setPhotoMessage('');
 try{
  const data=await req('/admin/products/image-suggestions?name='+encodeURIComponent(form.name.trim()),{},token);
  setPhotoSuggestions(data.suggestions||[]);
  if(!data.suggestions?.length)setPhotoMessage('Ainda não temos este produto no acervo. Envie uma foto própria ou tente outra grafia.');
 }catch{setPhotoMessage('A busca está indisponível. Você ainda pode salvar o produto.');}
 finally{setFindingPhotos(false);}
}
async function useProductPhoto(photo:any){
 setPhotoMessage('');
 if(photo.source==='curated'){
  setFindingPhotos(true);
  try{
   const result=await req('/admin/products/image-curated',{
    method:'POST',body:JSON.stringify({name:form.name.trim()})
   },token);
   setForm((prev:any)=>({...prev,imageUrl:result.imageUrl}));
   setPhotoMessage('Foto confirmada! Agora ela fica salva para todas as lojas.');
  }catch(e:any){
   setPhotoMessage('Foto localizada, mas a importação está indisponível. Vou usar a foto verificada.');
   setForm((prev:any)=>({...prev,imageUrl:photo.imageUrl}));
  }finally{setFindingPhotos(false);}
 }else if(photo.pageId){
  setFindingPhotos(true);
  try{
   const result=await req('/admin/products/image-import',{
    method:'POST',body:JSON.stringify({name:form.name.trim(),pageId:photo.pageId})
   },token);
   setForm((prev:any)=>({...prev,imageUrl:result.imageUrl}));
   setPhotoMessage('Foto escolhida e adicionada ao catálogo compartilhado.');
  }catch(e:any){setPhotoMessage(e.message||'Não foi possível importar a foto.');}
  finally{setFindingPhotos(false);}
 }else{
  setForm((prev:any)=>({...prev,imageUrl:photo.imageUrl}));
  setPhotoMessage('Foto escolhida para este produto.');
 }
}
async function uploadProductPhoto(e:any){
 const file=e.target.files?.[0];if(!file)return;
 setUploadingPhoto(true);setPhotoMessage('');
 try{
  const dataUri=await prepareBrandImage(file,'logo');
  const uploaded=await req('/admin/media/upload',{
   method:'POST',body:JSON.stringify({dataUri,folder:'products'})
  },token);
  setForm((prev:any)=>({...prev,imageUrl:uploaded.url}));
  setPhotoMessage('Sua foto foi enviada. Ela pertence somente a esta loja.');
 }catch(e:any){setPhotoMessage(e.message||'Não foi possível enviar a imagem.');}
 finally{setUploadingPhoto(false);e.target.value='';}
}
function setHalfAndHalf(enabled:boolean){
 const config=readCustomConfig(form.customConfig)||newCustomConfig();
 let groups=[...config.groups];
 let index=groups.findIndex((g:any)=>/sabor/i.test(g.name||''));
 if(enabled){
  if(index<0){const template=newPizzaConfig().groups.find((g:any)=>/sabor/i.test(g.name||''));if(template)groups.push(template);index=groups.length-1;}
  if(index>=0)groups[index]={...groups[index],kind:undefined,selectionMode:'half-and-half',min:1,max:2};
 }else if(index>=0){
  const current:any=groups[index];groups[index]={...current,selectionMode:undefined,min:1,max:1};
 }
 setForm((old:any)=>({...old,halfAndHalf:enabled,customConfig:{...config,groups}}));
}
async function save(e:any){e.preventDefault();setError('');try{
 if(form.saleMode==='custom')readCustomConfig(form.customConfig);
 if(['fixed','variants'].includes(form.saleMode)){
  if(!Array.isArray(form.variants)||!form.variants.length||form.variants.length>20||
   form.variants.some((v:any)=>!String(v.name||'').trim()||!String(v.price||'').trim()||
   parseBRLToCents(v.price)<=0||!Number.isSafeInteger(Number(v.deductionQty))||Number(v.deductionQty)<1))
   throw new Error('Informe todas as opções com nome, preço maior que zero e quantidade de estoque consumida.');
  if(form.saleMode==='fixed'&&(!Number.isFinite(Number(form.poolStock))||Number(form.poolStock)<0.001))
   throw new Error('Informe o estoque total do produto em kg.');
 }
if(editing){await req(`/admin/products/${editing.id}`,{method:'PATCH',body:JSON.stringify({name:form.name,categoryId:form.categoryId||null,description:form.description,imageUrl:form.imageUrl,featured:form.featured,...(!['variants','fixed'].includes(form.saleMode)?{ean:['unit','dual'].includes(form.saleMode)?(form.ean||'').trim():null,saleMode:form.saleMode==='dual'?'dual':form.saleMode==='weight'?'weight':undefined,customConfig:form.saleMode==='custom'?readCustomConfig(form.customConfig):undefined,priceCents:parseBRLToCents(form.price),promoPriceCents:form.promoPrice?parseBRLToCents(form.promoPrice):null,unitPriceCents:form.saleMode==='dual'?parseBRLToCents(form.unitPrice):null,unitWeightGrams:form.saleMode==='dual'?Number(form.unitWeightGrams):null,minQty:Number(form.minQty),stepQty:Number(form.stepQty)}:{})})},token);if(['variants','fixed'].includes(form.saleMode)){if(form.saleMode==='fixed'){await req(`/admin/products/${editing.id}/fixed-stock`,{method:'PATCH',body:JSON.stringify({physicalQtyGrams:Math.round(Number(form.poolStock)*1000)})},token);}const retained=form.variants.filter((v:any)=>v.id);for(const old of editing.variants||[])if(!retained.some((v:any)=>v.id===old.id))await req(`/admin/products/variant-items/${old.id}`,{method:'DELETE'},token);for(const v of form.variants.filter((x:any)=>x.name&&x.price)){const payload={name:v.name,sku:v.sku,priceCents:parseBRLToCents(v.price),promoPriceCents:v.promoPrice?parseBRLToCents(v.promoPrice):null,deductionQty:Number(v.deductionQty)};if(v.id)await req(`/admin/products/variant-items/${v.id}`,{method:'PATCH',body:JSON.stringify(payload)},token);else await req(`/admin/products/${editing.id}/variants`,{method:'POST',body:JSON.stringify({...payload,stockPoolId:form.sharedPool?editing.variants?.[0]?.stock_pool_id:null,stockQty:Number(v.stockQty||0)})},token);}}}else if(['variants','fixed'].includes(form.saleMode)){await req('/admin/products/with-variants',{method:'POST',body:JSON.stringify({name:form.name,categoryId:form.categoryId||null,description:form.description,imageUrl:form.imageUrl,featured:form.featured,fixedOptionsEnabled:form.saleMode==='fixed',sharedPool:form.saleMode==='fixed'||!!form.sharedPool,poolPhysicalQty:form.saleMode==='fixed'?Math.round(Number(form.poolStock)*1000):Number(form.poolStock),poolName:`${form.name} — estoque compartilhado`,variants:form.variants.filter((v:any)=>v.name&&v.price).map((v:any)=>({...v,priceCents:parseBRLToCents(v.price),promoPriceCents:v.promoPrice?parseBRLToCents(v.promoPrice):null}))})},token);}else{await req('/admin/products',{method:'POST',body:JSON.stringify({name:form.name,saleMode:form.saleMode,ean:['unit','dual'].includes(form.saleMode)?(form.ean||'').trim():null,customConfig:form.saleMode==='custom'?readCustomConfig(form.customConfig):undefined,unitLabel:form.unitLabel,unitPriceCents:form.saleMode==='dual'?parseBRLToCents(form.unitPrice):null,unitWeightGrams:form.saleMode==='dual'?Number(form.unitWeightGrams):null,priceCents:parseBRLToCents(form.price),promoPriceCents:form.promoPrice?parseBRLToCents(form.promoPrice):null,imageUrl:form.imageUrl,stockQty:form.saleMode==='weight'||form.saleMode==='dual'?Math.round(Number(form.stock)*1000):Number(form.stock),categoryId:form.categoryId||null,minQty:Number(form.minQty),stepQty:Number(form.stepQty),featured:form.featured,description:form.description})},token);}setModal(false);setEditing(null);await load();}catch(e:any){setError(e.message);}}return <><PageHead eyebrow={saleModes.includes('pizzeria')?'CATÁLOGO · PIZZARIA':'CATÁLOGO'} title="Produtos" desc={`${items.length} produtos cadastrados na sua loja.`} action={<div className="product-catalog-actions">
 <button type="button" className="btn btn-outline" disabled={backfilling} onClick={fillMissingImages}>
 <ImageIcon size={16}/> {backfilling?'Procurando fotos…':'Preencher fotos faltantes'}</button>
 <button className="btn btn-primary" disabled={!saleModesLoaded||saleModes.length===0} title={!saleModesLoaded?"Carregando modalidades autorizadas…":saleModes.length===0?"Nenhuma modalidade habilitada para esta loja.":""} onClick={()=>{setEditing(null);setError('');setPhotoSuggestions([]);setPhotoMessage('');setForm((p:any)=>({...p,name:'',imageUrl:'',description:'',saleMode:saleModes.includes('weight')?'weight':(saleModes.includes('unit')||saleModes.includes('pizzeria'))?'unit':'custom',customConfig:newCustomConfig(),price:'',promoPrice:'',stock:'',categoryId:'',featured:false,sharedPool:true,poolStock:20,variants:[{name:'Meio Kg',sku:'',price:'',promoPrice:'',deductionQty:500}]}));setModal(true);}}><Plus size={17}/> Novo produto</button>
 </div>}/>{saleModes.includes('pizzeria')&&<div className="integration-note">🍕 Modo Pizzaria habilitado: cadastre pizzas e lanches como produtos personalizáveis para configurar tamanhos, sabores, bordas, adicionais e ingredientes que o cliente pode retirar. Bebidas e outros itens simples devem ser cadastrados por unidade. As categorias Pizzas, Lanches, Bebidas, Porções e Combos já ficam disponíveis.</div>}{photoBatchNotice&&<div className="success-banner" role="status">{photoBatchNotice}</div>}{error&&<div className="error-banner">{error}</div>}<div className="panel-card"><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Modo de venda</th><th>Preço</th><th>Estoque interno</th><th>Disponível</th><th></th></tr></thead><tbody>{items.map(p=><tr key={p.id}><td><div className="product-cell"><img src={img(p.image_url)}/><span><b>{p.name}</b><small>{p.sku||'Sem SKU'}</small></span></div></td><td>{p.category_name||'—'}</td><td>{p.custom_config_json?'Personalizável':productIsDual(p)?'Por kg e unidade':p.sale_mode==='weight'?'Peso':p.fixed_options_enabled?'Preço fixo por quantidade':p.sale_mode==='variants'?'Variações':'Unidade'}</td><td><b>{p.sale_mode==='variants'&&p.variants?.length?money(Math.min(...p.variants.map((v:any)=>v.promo_price_cents&&v.promo_price_cents<v.price_cents?v.promo_price_cents:v.price_cents))):money(p.promo_price_cents||p.price_cents)}</b><small className="cell-sub">{productIsDual(p)?`/ kg · ${money(p.unit_price_cents)} / unidade`:p.sale_mode==='variants'?'a partir de':p.unit_label}</small></td><td>{p.fixed_options_enabled?formatWeightGrams(Number(p.variants?.[0]?.pool_physical_qty||0)):p.sale_mode==='variants'?'Por variação':p.sale_mode==='weight'?formatWeightGrams(p.available_internal):`${p.available_internal} ${p.unit_label}`}</td><td><span className={`status-badge ${p.is_active?'green':'gray'}`}><i/>{p.is_active?'Ativo':'Inativo'}</span></td><td><div className="table-actions"><button className="btn btn-xs btn-outline" onClick={()=>openEdit(p)}>Editar</button><button className="btn btn-xs btn-outline" onClick={async()=>{await req(`/admin/products/${p.id}`,{method:'PATCH',body:JSON.stringify({active:!p.is_active})},token);load();}}>{p.is_active?'Desativar':'Ativar'}</button>{!p.is_active&&<button type="button" className="btn btn-xs btn-outline product-delete-btn" onClick={async()=>{if(!window.confirm('Excluir '+p.name+' do catálogo? Os pedidos anteriores serão preservados.'))return;setError('');try{await req(`/admin/products/${p.id}`,{method:'DELETE'},token);await load();}catch(e:any){setError(e.message);}}}><Trash2 size={14}/> Excluir</button>}</div></td></tr>)}</tbody></table>{!items.length&&<div className="empty-table">Cadastre o primeiro produto para começar.</div>}</div></div>{modal&&<div className="modal-backdrop"><form className="form-modal" onSubmit={save}><div className="modal-heading"><div><span className="eyebrow">{editing?'EDITAR CATÁLOGO':'NOVO ITEM NO CATÁLOGO'}</span><h2>{editing?'Editar produto':'Cadastrar produto'}</h2></div><button type="button" className="icon-btn" onClick={()=>setModal(false)}><X/></button></div><div className="form-grid"><label className="full">Nome do produto<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Tomate italiano"/></label><label>Categoria<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}><option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Modo de venda<select disabled={!!editing&&editing.sale_mode!=='weight'} value={form.saleMode} onChange={e=>{const mode=e.target.value;setForm({...form,saleMode:mode,unitLabel:mode==='weight'||mode==='dual'?'kg':'un',minQty:mode==='unit'||mode==='custom'?1:100,stepQty:mode==='unit'||mode==='custom'?1:50,...(mode==='custom'?{customConfig:form.customConfig||newCustomConfig()}:{}),...(mode==='fixed'?{sharedPool:true,poolStock:20,variants:[{name:'Meio Kg',price:'',promoPrice:'',deductionQty:500},{name:'1 Kg',price:'',promoPrice:'',deductionQty:1000},{name:'1,5 Kg',price:'',promoPrice:'',deductionQty:1500},{name:'2 Kg',price:'',promoPrice:'',deductionQty:2000}]}:{})});}}>{saleModes.includes("weight")&&<option value="weight">Somente por kg</option>}{(saleModes.includes("unit")||saleModes.includes("pizzeria"))&&<option value="unit">Somente por unidade</option>}{saleModes.includes("dual")&&saleModes.includes("weight")&&saleModes.includes("unit")&&<option value="dual">Por kg e por unidade</option>}{saleModes.includes("variants")&&<><option value="variants">Embalagens / variações</option><option value="fixed">Preço fixo por quantidade (500 g, 1 kg…)</option></>}{(saleModes.includes("custom")||saleModes.includes("pizzeria"))&&<option value="custom">{saleModes.includes("pizzeria")?'Pizza, lanches e produtos personalizáveis':'Produto personalizável (marmitex, lanches)'}</option>}</select></label>{['variants','fixed'].includes(form.saleMode)?<>{form.saleMode!=='fixed'&&<label className="check-row full"><input type="checkbox" disabled={!!editing} checked={form.sharedPool} onChange={e=>setForm({...form,sharedPool:e.target.checked})}/> As variações usam o mesmo estoque físico</label>}{(form.saleMode==='fixed'||form.sharedPool)&&<label className="full">{form.saleMode==='fixed'?'Estoque total do produto (kg)':'Estoque físico total (unidades base)' }<input required type="number" min="0.001" step={form.saleMode==='fixed'?'0.001':'1'} value={form.poolStock} onChange={e=>setForm({...form,poolStock:e.target.value})}/><small>{form.saleMode==='fixed'?'Exemplo: 20 kg disponíveis. A opção de 500 g desconta 500 g do mesmo estoque.':'Exemplo: 360 ovos no total. Cada embalagem desconta a quantidade definida abaixo.'}</small></label>}<div className="variant-editor full"><div className="variant-editor-head"><b>{form.saleMode==='fixed'?'Opções de quantidade e preço':'Embalagens para venda'}</b><button type="button" className="btn btn-xs btn-outline" onClick={()=>setForm({...form,variants:[...form.variants,{name:'',sku:'',price:'',promoPrice:'',deductionQty:form.saleMode==='fixed'?500:1}]})}><Plus size={13}/> Adicionar opção</button></div>{form.variants.map((v:any,i:number)=><div className={`variant-row ${form.saleMode==='fixed'?'fixed-option-editor':''}`} key={i}><input aria-label="Nome da variação" placeholder={form.saleMode==='fixed'?'Opção (ex.: Meio Kg)':'Nome (ex.: Dúzia)'} value={v.name} onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,name:e.target.value}:x)})}/>{form.saleMode!=='fixed'&&<input aria-label="SKU" placeholder="SKU" value={v.sku} onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,sku:e.target.value}:x)})}/>}<input aria-label="Preço da variação" placeholder={form.saleMode==='fixed'?'Preço fixo R$':'Preço R$'} value={v.price} onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,price:e.target.value}:x)})}/>{form.saleMode!=='fixed'&&<input aria-label="Preço promocional da variação" placeholder="Promo R$" value={v.promoPrice||''} onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,promoPrice:e.target.value}:x)})}/>}<input aria-label="Unidades consumidas" type="number" min="1" title="Unidades do estoque físico consumidas" placeholder={form.saleMode==='fixed'?'Peso (g)':'Consome'} value={v.deductionQty} required onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,deductionQty:e.target.value}:x)})}/>{form.variants.length>1&&<button type="button" className="icon-btn" onClick={()=>setForm({...form,variants:form.variants.filter((_:any,j:number)=>j!==i)})}><X size={15}/></button>}{form.saleMode!=='fixed'&&!form.sharedPool&&<input aria-label="Estoque inicial da variação" type="number" min="0" placeholder="Estoque" value={v.stockQty??''} required onChange={e=>setForm({...form,variants:form.variants.map((x:any,j:number)=>j===i?{...x,stockQty:e.target.value}:x)})}/>}</div>)}</div></>:<><>{['unit','dual'].includes(form.saleMode)&&<label>Código EAN / código de barras (opcional)<input inputMode="numeric" autoComplete="off" maxLength={14} value={form.ean||''} onChange={e=>setForm({...form,ean:e.target.value.replace(/\\D/g,'').slice(0,14)})} placeholder="Ex.: 7891234567890"/><small>Informe o código de barras da embalagem, se houver.</small></label>}</><label>{form.saleMode==='custom'?'Preço base (R$)':form.saleMode==='unit'?'Preço por unidade (R$)':'Preço por kg (R$)'}<input required value={form.price} onChange={e=>setForm({...form,price:e.target.value})} placeholder="0,00" inputMode="decimal"/></label>{form.saleMode==='dual'&&<><label>Preço de 1 unidade (R$)<input required inputMode="decimal" value={form.unitPrice||''} onChange={e=>setForm({...form,unitPrice:e.target.value})} placeholder="Ex.: 1,50"/></label><label>Peso médio de 1 unidade (gramas)<input required type="number" min="1" step="1" value={form.unitWeightGrams||''} onChange={e=>setForm({...form,unitWeightGrams:e.target.value})} placeholder="Ex.: 180"/><small>Usado para descontar do mesmo estoque em kg. Ex.: 1 unidade pesa aproximadamente 180 g.</small></label></>}<label>Preço promocional (opcional)<input value={form.promoPrice||''} onChange={e=>setForm({...form,promoPrice:e.target.value})} placeholder="0,00" inputMode="decimal"/></label><label>Estoque inicial ({form.saleMode==='weight'||form.saleMode==='dual'?'kg':'un'})<input type="number" min="0" step="any" value={form.stock} required={!editing} onChange={e=>setForm({...form,stock:e.target.value})}/></label>{form.saleMode!=='custom'&&<><label>Quantidade mínima{form.saleMode==='weight'||form.saleMode==='dual'?' (g)':' (un)'}<input type="number" min="1" value={form.minQty} required onChange={e=>setForm({...form,minQty:e.target.value})}/></label><label>Incremento{form.saleMode==='weight'||form.saleMode==='dual'?' (g)':' (un)'}<input type="number" min="1" value={form.stepQty} required onChange={e=>setForm({...form,stepQty:e.target.value})}/></label></>}{form.saleMode==='custom'&&<CustomConfigEditor value={form.customConfig||newCustomConfig()} baseCents={Number.isFinite(Number(String(form.price||'0').replace(',','.')))?Math.round(Number(String(form.price||'0').replace(',','.'))*100):0} onChange={customConfig=>setForm((old:any)=>({...old,customConfig}))}/>}</>}<div className="product-auto-photo full">
 <div className="product-auto-photo-header"><b>Foto do produto</b><small>Busca automática pelo nome</small></div>
 {form.imageUrl?<div className="product-selected-photo"><img src={form.imageUrl} alt="Foto selecionada"/><button type="button" className="btn btn-xs btn-outline" onClick={()=>setForm((p:any)=>({...p,imageUrl:''}))}>Trocar foto</button></div>:
 photoSuggestions.length?<div className="product-photo-recommend"><img src={photoSuggestions[0].imageUrl} alt="Foto encontrada"/><span>Foto encontrada no catálogo. A correspondência segura é aplicada ao salvar.</span></div>:
 <p className="product-photo-empty">Digite o nome do produto para encontrar uma foto automaticamente.</p>}
 <button type="button" className="btn btn-xs btn-outline" disabled={findingPhotos||uploadingPhoto||!form.name?.trim()} onClick={searchProductPhotos}><Search size={14}/> {findingPhotos?'Pesquisando…':'Pesquisar mais imagens'}</button>
 {!!photoSuggestions.length&&<div className="product-image-suggestions">{photoSuggestions.map((p:any,i:number)=>
 <button type="button" className="product-image-option" key={p.pageId||p.imageUrl||i} disabled={findingPhotos} onClick={()=>useProductPhoto(p)} title={p.title}>
  <img src={p.imageUrl} alt={'Opção de foto '+(i+1)}/><small>{p.source==='builtin'?'Do catálogo':p.source==='library'?'Compartilhada':p.source==='curated'?'Foto verificada':'Fonte aberta'} · Usar</small>
 </button>)}</div>}
 <label className="product-image-upload">Ou envie sua própria imagem
 <input type="file" accept={IMAGE_ACCEPT} disabled={findingPhotos||uploadingPhoto} onChange={uploadProductPhoto}/></label>
 {uploadingPhoto&&<small>Enviando foto…</small>}
 {photoMessage&&<small className="product-photo-message" role="status">{photoMessage}</small>}
 <small className="product-image-help">Fotos abertas podem ser usadas por outras lojas. Fotos enviadas pelo proprietário permanecem privadas à sua loja.</small>
</div><label className="full">Descrição<textarea value={form.description||''} onChange={e=>setForm({...form,description:e.target.value})}/></label><div className="product-final-flags full"><label className="check-row"><input type="checkbox" checked={form.featured||false} onChange={e=>setForm({...form,featured:e.target.checked})}/> Destacar na vitrine</label>{form.saleMode==='custom'&&saleModes.includes('pizzeria')&&<label className="check-row"><input type="checkbox" checked={!!form.halfAndHalf} onChange={e=>setHalfAndHalf(e.target.checked)}/> Pizza vendida meio a meio</label>}</div></div>{error&&<div className="error-banner">{error}</div>}<div className="modal-footer"><button type="button" className="btn btn-outline" onClick={()=>setModal(false)}>Cancelar</button><button className="btn btn-primary">Salvar produto</button></div></form></div>}</>}
function Categories({token}:any){const[items,setItems]=useState<any[]>([]),[name,setName]=useState(''),[icon,setIcon]=useState('🥬'),[error,setError]=useState('');async function load(){setItems((await req('/admin/categories',{},token)).categories||[]);}useEffect(()=>{load();},[]);async function add(e:any){e.preventDefault();try{await req('/admin/categories',{method:'POST',body:JSON.stringify({name,icon})},token);setName('');load();}catch(e:any){setError(e.message);}}return <><PageHead eyebrow="ORGANIZAÇÃO DO CATÁLOGO" title="Categorias" desc="Agrupe produtos para facilitar a navegação na vitrine."/><form className="inline-create panel-card" onSubmit={add}><label>Nome da nova categoria<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Temperos" required/></label><label>Ícone<input className="emoji-input" value={icon} onChange={e=>setIcon(e.target.value)}/></label><button className="btn btn-primary"><Plus size={16}/> Criar categoria</button></form>{error&&<div className="error-banner">{error}</div>}<div className="category-admin-grid">{items.map((c:any)=><div className="category-admin-card" key={c.id}><span>{c.icon}</span><div><b>{c.name}</b><small>{c.slug}</small></div><div className="category-actions"><button className="btn btn-xs btn-outline" onClick={async()=>{const next=window.prompt('Nome da categoria:',c.name);if(next&&next.trim()){await req(`/admin/categories/${c.id}`,{method:'PATCH',body:JSON.stringify({name:next.trim()})},token);load();}}}>Editar</button><button className="btn btn-xs btn-outline" onClick={async()=>{await req(`/admin/categories/${c.id}`,{method:'PATCH',body:JSON.stringify({active:!c.is_active})},token);load();}}>{c.is_active?'Desativar':'Ativar'}</button></div></div>)}</div></>}
function Stock({token}:any){const[data,setData]=useState<any>({products:[],variants:[],pools:[],movements:[]}),[target,setTarget]=useState<any>(null),[qty,setQty]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');async function load(){try{const response=await req('/admin/stock',{},token);setData({products:Array.isArray(response.products)?response.products:[],variants:Array.isArray(response.variants)?response.variants:[],pools:Array.isArray(response.pools)?response.pools:[],movements:Array.isArray(response.movements)?response.movements:[]});setError('');}catch(e:any){setError(e?.message||'Não foi possível carregar o estoque.');}}useEffect(()=>{load();},[]);async function adjust(e:any){e.preventDefault();try{await req('/admin/stock/adjust',{method:'POST',body:JSON.stringify({targetType:target.type,targetId:target.id,quantity:Number(qty),reason})},token);setTarget(null);setQty('');load();}catch(e:any){setError(e.message);}}return <><PageHead eyebrow="CONTROLE OPERACIONAL" title="Estoque" desc="Disponibilidade interna e histórico de movimentações."/>{error&&<div className="error-banner">{error}</div>}<div className="panel-card"><div className="panel-heading"><div><h2>Estoque de produtos</h2><p>A quantidade exibida aqui é interna, somente para equipe.</p></div></div><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Modo</th><th>Físico</th><th>Reservado</th><th>Disponível</th><th></th></tr></thead><tbody>{data.products.map((p:any)=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.sale_mode}</td><td>{p.sale_mode==='weight'?formatWeightGrams(p.physical_qty):p.physical_qty}</td><td>{p.reserved_qty}</td><td><b>{p.sale_mode==='weight'?formatWeightGrams(p.physical_qty-p.reserved_qty):p.physical_qty-p.reserved_qty}</b></td><td><button className="btn btn-xs btn-outline" onClick={()=>setTarget({id:p.id,type:'product',name:p.name})}>Ajustar</button></td></tr>)}{data.variants.map((p:any)=><tr key={p.id}><td><b>{p.product_name} — {p.name}</b><small className="cell-sub">Variação</small></td><td>un</td><td>{p.physical_qty}</td><td>{p.reserved_qty}</td><td><b>{p.physical_qty-p.reserved_qty}</b></td><td><button className="btn btn-xs btn-outline" onClick={()=>setTarget({id:p.id,type:'variant',name:`${p.product_name} — ${p.name}`})}>Ajustar</button></td></tr>)}{data.pools.map((p:any)=><tr key={p.id}><td><b>{p.name}</b><small className="cell-sub">Pool compartilhado</small></td><td>{p.base_unit}</td><td>{p.physical_qty}</td><td>{p.reserved_qty}</td><td><b>{p.physical_qty-p.reserved_qty}</b></td><td><button className="btn btn-xs btn-outline" onClick={()=>setTarget({id:p.id,type:'pool',name:p.name})}>Ajustar</button></td></tr>)}</tbody></table></div></div><div className="panel-card movement-card"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p>Registro de reservas, baixas e ajustes.</p></div><History size={18}/></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Item</th><th>Movimento</th><th>Δ físico</th><th>Motivo</th></tr></thead><tbody>{data.movements.slice(0,35).map((m:any)=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString('pt-BR')}</td><td>{m.target_name}</td><td>{m.movement_type}</td><td>{m.delta_physical}</td><td>{m.reason||'—'}</td></tr>)}</tbody></table></div></div>{target&&<div className="modal-backdrop"><form className="form-modal narrow" onSubmit={adjust}><div className="modal-heading"><div><span className="eyebrow">AJUSTE MANUAL</span><h2>{target.name}</h2></div><button type="button" className="icon-btn" onClick={()=>setTarget(null)}><X/></button></div><label>Quantidade a somar ou subtrair<input required type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="Ex.: 10 ou -2"/></label><label>Motivo do ajuste<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reposição, perda, conferência…"/></label>{error&&<div className="error-banner">{error}</div>}<button className="btn btn-primary btn-block">Salvar ajuste</button></form></div>}</>}
function Customers({token}:any){
 const[data,setData]=useState<any[]>([]),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{req('/admin/customers',{},token).then(x=>setData(x.customers||[])).catch(e=>setError(e.message));},[token]);
 const filtered=data.filter(x=>`${x.name} ${x.phone} ${x.email||''}`.toLowerCase().includes(query.toLowerCase()));
 return <>
  <PageHead eyebrow="RELACIONAMENTO" title="Clientes" desc={`${data.length} clientes registrados nesta loja por pedidos e pelo pop-up.`}/>
  {error&&<div className="error-banner">{error}</div>}
  <div className="toolbar panel-card"><div className="store-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail"/></div><span>{filtered.length} resultados</span></div>
  <div className="panel-card"><div className="table-wrap"><table>
    <thead><tr><th>Cliente</th><th>Celular</th><th>E-mail</th><th>Origem</th><th>Pedidos</th><th>Total comprado</th><th>Novidades autorizadas</th></tr></thead>
    <tbody>{filtered.map(c=><tr key={c.id}>
      <td><b>{c.name}</b></td><td>{c.phone}</td><td>{c.email||'—'}</td>
      <td>{c.signup_source==='popup'?'Cadastro da vitrine':'Pedido'}</td>
      <td>{c.orders_count}</td><td>{money(c.total_spent_cents)}</td>
      <td>{c.marketing_opt_in?'Sim':'Não'}</td>
    </tr>)}</tbody>
  </table>{!filtered.length&&<div className="empty-table">Ainda não há clientes cadastrados.</div>}</div></div>
 </>;
}
function Reports({token}:any){const[period,setPeriod]=useState('30'),[data,setData]=useState<any>(null);async function load(){const to=new Date(),from=new Date();from.setDate(to.getDate()-Number(period));setData(await req(`/admin/reports?from=${from.toISOString().slice(0,10)}&to=${to.toISOString().slice(0,10)}`,{},token));}useEffect(()=>{load();},[period]);return <><PageHead eyebrow="ANÁLISE DE VENDAS" title="Relatórios" desc="Desempenho comercial no período selecionado." action={<select className="period-select" value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>}/><div className="stats-grid report-stats">{[['Pedidos no período',data?.summary?.orders_count||0,ClipboardList],['Vendas confirmadas',money(data?.summary?.sales_cents||0),BarChart3],['Ticket médio',money(data?.summary?.avg_ticket_cents||0),ShoppingBasket]].map(([label,val,I]:any)=><div className="stat-card" key={label}><div className="stat-icon green"><I size={20}/></div><div><small>{label}</small><b>{val}</b></div></div>)}</div><div className="panel-card"><div className="panel-heading"><div><h2>Produtos mais vendidos</h2><p>Por receita no período escolhido</p></div></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Produto</th><th>Quantidade</th><th>Vendas</th></tr></thead><tbody>{(data?.topProducts||[]).map((p:any,i:number)=><tr key={p.product_name_snapshot}><td>{String(i+1).padStart(2,'0')}</td><td><b>{p.product_name_snapshot}</b></td><td>{p.quantity}</td><td><b>{money(p.sales_cents)}</b></td></tr>)}</tbody></table>{!data?.topProducts?.length&&<div className="empty-table">Sem vendas no período selecionado.</div>}</div></div></>}
function WhatsApp({token}:any){const[status,setStatus]=useState<any>(null),[templates,setTemplates]=useState<any[]>([]),[messages,setMessages]=useState<any[]>([]),[tab,setTab]=useState('connection'),[error,setError]=useState(''),[recipient,setRecipient]=useState(''),[savingRecipient,setSavingRecipient]=useState(false),[recipientNotice,setRecipientNotice]=useState('');async function load(){const[s,t,q,r]=await Promise.all([req('/admin/whatsapp/status',{},token),req('/admin/whatsapp/templates',{},token),req('/admin/whatsapp/queue',{},token),req('/admin/whatsapp/order-recipient',{},token)]);setStatus(s);setTemplates(t.templates||[]);setMessages(q.messages||[]);setRecipient(r.phone||'');}useEffect(()=>{load().catch(e=>setError(e.message));const id=setInterval(()=>req('/admin/whatsapp/status',{},token).then(setStatus).catch(()=>{}),10000);return()=>clearInterval(id);},[]);async function action(path:string){setError('');try{const x=await req(path,{method:'POST',body:'{}'},token);if(x.error)throw Error(x.error);setStatus(x);await load();}catch(e:any){setError(e.message);}}async function saveRecipient(){setSavingRecipient(true);setRecipientNotice('');setError('');try{const r=await req('/admin/whatsapp/order-recipient',{method:'PUT',body:JSON.stringify({phone:recipient})},token);setRecipient(r.phone||'');setRecipientNotice(r.phone?'Número de recebimento salvo.':'Envio interno desativado.');}catch(e:any){setError(e.message);}finally{setSavingRecipient(false);}}async function saveTemplate(t:any){try{await req(`/admin/whatsapp/templates/${t.event_type}`,{method:'PUT',body:JSON.stringify({messageTemplate:t.message_template,enabled:!!t.is_enabled})},token);await load();}catch(e:any){setError(e.message);}}return <><PageHead eyebrow="MENSAGENS TRANSACIONAIS" title="WhatsApp" desc="Conexão e notificações de pedidos da sua loja."/><div className="wa-tabs">{[['connection','Conexão'],['templates','Modelos'],['auto','Atendimento automático'],['history','Histórico de envios']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>{error&&<div className="error-banner">{error}</div>}{tab==='connection'&&<div className="wa-layout"><section className="panel-card wa-connection"><div className="wa-status-head"><span className={`wa-status-icon ${status?.status}`}><MessageCircle size={25}/></span><span><span className={`status-badge ${status?.status==='connected'?'green':'yellow'}`}><i/>{!status?.configured?'Não configurado':status?.status==='connected'?'Conectado':status?.status==='qr_pending'?'Aguardando leitura':'Desconectado'}</span><h2>{status?.connected_phone||'WhatsApp da loja'}</h2><small>{status?.profile_name||'Conecte um telefone para enviar notificações transacionais.'}</small></span></div><div className="wa-controls">
 {!status?.configured?
   <button className="btn btn-outline" disabled><MessageCircle size={17}/> Configuração pendente</button>
  :status?.status==='connected'?<>
   <button className="btn btn-outline" onClick={()=>action('/admin/whatsapp/connect')}><RefreshCw size={16}/> Verificar conexão</button>
   <button className="btn btn-danger-soft" onClick={()=>action('/admin/whatsapp/disconnect')}>Desconectar</button>
  </>:<>
   <button className="btn btn-primary" onClick={()=>action('/admin/whatsapp/connect')}><MessageCircle size={17}/> {status?.status==='qr_pending'?'Atualizar QR Code':'Conectar WhatsApp'}</button>
   {status?.status==='qr_pending'&&<button className="btn btn-outline" onClick={()=>action('/admin/whatsapp/refresh-qr')}><RefreshCw size={16}/> Atualizar QR</button>}
  </>}
 </div><div className="panel-card" style={{marginTop:16}}><div className="panel-heading"><div><h3>📥 WhatsApp que recebe os pedidos</h3><p>O número conectado envia o resumo de cada novo pedido para este destinatário.</p></div></div><label>Número do funcionário ou responsável<input type="tel" inputMode="tel" autoComplete="tel" placeholder="Ex.: 73999999999" value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><small>Informe DDD e número. O destinatário não precisa conectar outro WhatsApp à plataforma.</small><div className="template-footer"><button className="btn btn-primary" disabled={savingRecipient} onClick={saveRecipient}>{savingRecipient?'Salvando…':'Salvar destinatário'}</button>{recipientNotice&&<small role="status">{recipientNotice}</small>}</div></div>{status?.status==='qr_pending'&&<div className="qr-panel"><div className="qr-image">{status.qr_code_base64?<img src={status.qr_code_base64} alt="QR Code de conexão WhatsApp"/>:<div className="qr-placeholder"><MessageCircle size={34}/><small>QR Code aguardando resposta da Evolution API…</small></div>}</div><div><b>Escaneie com o WhatsApp</b><p>Abra WhatsApp → Dispositivos conectados → Conectar dispositivo e aponte a câmera para este código.</p></div></div>}{!status?.configured&&<p className="integration-note"><ShieldCheck size={15}/> Para gerar um QR real, o administrador CR Jornada precisa configurar as credenciais Evolution do sistema. Nenhuma conexão de simulação será exibida.</p>}
{status?.configured&&!status?.webhook_configured&&<p className="integration-note"><ShieldCheck size={15}/> A Evolution está configurada, mas falta configurar a chave do webhook para sincronizar automaticamente o status.</p>}
{status?.configured&&!status?.telegram_alerts_configured&&
  <p className="integration-note"><ShieldCheck size={15}/> Alertas de desconexão no Telegram aguardando a configuração
  do bot e do chat de destino pelo Super Admin.</p>}
{status?.configured&&status?.telegram_alerts_configured&&
  <p className="integration-note"><ShieldCheck size={15}/> Alertas de desconexão no Telegram ativados.
  O aviso identifica o estabelecimento e é reenviado se houver falha temporária.</p>}
{status?.last_error&&<p className="integration-note" role="alert">{status.last_error}</p>}</section><section className="panel-card wa-info"><h3>Fluxo de mensagens</h3><div className="wa-step"><span>1</span><div><b>Pedido recebido</b><small>Cliente recebe confirmação ao finalizar.</small></div></div><div className="wa-step"><span>2</span><div><b>Pedido aceito</b><small>Resumo de itens, total e pagamento.</small></div></div><div className="wa-step"><span>3</span><div><b>Saiu para entrega</b><small>Aviso automático de saída da loja.</small></div></div><p>Os envios dependem da autorização transacional escolhida no checkout.</p></section></div>}{tab==='templates'&&<div className="template-list">{templates.map((t:any)=><TemplateCard key={t.event_type} template={t} onSave={saveTemplate}/>)}</div>}{tab==='auto'&&<WhatsAppAutoReplies token={token}/>}{tab==='history'&&<div className="panel-card"><div className="table-wrap"><table><thead><tr><th>Data</th><th>Destinatário</th><th>Evento</th><th>Status</th><th>Tentativas</th><th></th></tr></thead><tbody>{messages.map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString('pt-BR')}</td><td>{m.recipient_name}<small className="cell-sub">{m.recipient_phone}</small></td><td>{m.event_type}</td><td><span className={`status-badge ${m.status==='sent'?'green':m.status==='failed'?'gray':'yellow'}`}><i/>{m.status}</span>{m.last_error&&<small className="cell-sub">{m.last_error}</small>}</td><td>{m.attempts}/{m.max_attempts}</td><td>{m.status!=='sent'&&<button className="btn btn-xs btn-outline" onClick={async()=>{await req(`/admin/whatsapp/queue/${m.id}/retry`,{method:'POST'},token);load();}}>Tentar novamente</button>}</td></tr>)}</tbody></table>{!messages.length&&<div className="empty-table">Nenhum envio registrado ainda.</div>}</div></div>}</>}
function TemplateCard({template,onSave}:any){const[t,setT]=useState(template);return <div className="panel-card template-card"><div className="template-head"><div><span className="eyebrow">{t.event_type.replaceAll('_',' ').toUpperCase()}</span><h3>{t.title}</h3></div><label className="switch"><input type="checkbox" checked={!!t.is_enabled} onChange={e=>setT({...t,is_enabled:e.target.checked?1:0})}/><span/></label></div><textarea rows={5} value={t.message_template} onChange={e=>setT({...t,message_template:e.target.value})}/><div className="template-footer"><small>Variáveis: {'{primeiro_nome}'} · {'{nome_estabelecimento}'} · {'{numero_pedido}'} · {'{itens_pedido}'} · {'{valor_total}'} · {'{status_pedido}'} · {'{subtotal}'} · {'{taxa_entrega}'} · {'{economia_info}'} · {'{forma_pagamento}'} · {'{troco_info}'} · {'{endereco_entrega}'} · {'{previsao_entrega}'}</small><button className="btn btn-sm btn-primary" onClick={()=>onSave(t)}><Check size={15}/> Salvar modelo</button></div></div>}
function SettingsPanel({token}:any){const[data,setData]=useState<any>(null),[saved,setSaved]=useState(false),[error,setError]=useState(''),[uploading,setUploading]=useState(''),[uploadStage,setUploadStage]=useState(''),[mediaNotice,setMediaNotice]=useState('');useEffect(()=>{req('/admin/settings',{},token).then(x=>setData({...x.settings,neighborhoods:x.neighborhoods||[],newNeighborhoodName:'',newNeighborhoodFee:'0,00',defaultFeeDisplay:(Number(x.settings.default_delivery_fee_cents||0)/100).toFixed(2).replace('.',','),freeFeeDisplay:x.settings.free_delivery_min_cents==null?'':(Number(x.settings.free_delivery_min_cents)/100).toFixed(2).replace('.',','),minOrderDisplay:(Number(x.settings.min_order_cents||0)/100).toFixed(2).replace('.',',')})).catch(e=>setError(e.message));},[]);if(!data)return <><PageHead eyebrow="IDENTIDADE E ENTREGA" title="Configurações" desc="Personalize sua loja e as condições de venda."/>{error}</>;function set(k:string,v:any){setData({...data,[k]:v});}async function uploadBrandImage(e:any,key:'logo_url'|'banner_url'){
 const input=e.currentTarget as HTMLInputElement;
 const file=input.files?.[0];if(!file)return;
 setError('');setMediaNotice('');setUploading(key);
 try{
  setUploadStage('Preparando e otimizando imagem…');
  const logoPalette=key==='logo_url'?await extractLogoPalette(file):null;
  const dataUri=await prepareBrandImage(file,key==='logo_url'?'logo':'banner');
  setUploadStage('Enviando imagem para armazenamento…');
  const uploaded=await reqWithTimeout('/admin/media/upload',{
   method:'POST',body:JSON.stringify({dataUri,folder:'branding'})
  },token,45000);
  if(!uploaded?.url)throw new Error('O armazenamento não retornou o endereço da imagem. Tente novamente.');
  // Persistir a nova imagem imediatamente, mesmo se o usuário não clicar em Salvar.
  setUploadStage('Salvando a imagem nas configurações da loja…');
  await reqWithTimeout('/admin/settings',{
   method:'PATCH',body:JSON.stringify({
    [key==='logo_url'?'logoUrl':'bannerUrl']:uploaded.url,
    ...(logoPalette?{logoPalette}: {})
   })
  },token,30000);
  setData((old:any)=>({...old,[key]:uploaded.url,...(logoPalette?{logo_palette_json:JSON.stringify(logoPalette)}:{})}));
  setMediaNotice(key==='logo_url'?'Logomarca salva! Já aparece na vitrine.':'Banner salvo! Já aparece na vitrine.');
 }catch(err:any){setError(err.message||'Não foi possível enviar a imagem.');}
 finally{setUploading('');setUploadStage('');input.value='';}
}
/** Desvincula somente a logomarca desta loja; não remove imagens de outros estabelecimentos. */
async function removeBrandLogo(){
 if(!data.logo_url||uploading)return;
 if(!window.confirm('Remover a logomarca desta loja? A vitrine e a comanda passarão a usar o nome do estabelecimento.'))return;
 setSaved(false);setError('');setMediaNotice('');setUploading('logo_url');
 try{
  await req('/admin/settings',{method:'PATCH',body:JSON.stringify({logoUrl:null,useLogoColors:false,logoPalette:null})},token);
  setData((old:any)=>({...old,logo_url:null,use_logo_colors:0,logo_palette_json:null}));
  setMediaNotice('Logomarca removida da loja. A vitrine já foi atualizada e a comanda usará o nome do estabelecimento.');
 }catch(err:any){setError(err.message||'Não foi possível remover a logomarca.');}
 finally{setUploading('');}
}
async function save(){setSaved(false);setError('');try{await req('/admin/settings',{method:'PATCH',body:JSON.stringify({name:data.name,logoUrl:data.logo_url,bannerUrl:data.banner_url,logoPalette:readLogoPalette(data.logo_palette_json),useLogoColors:!!data.use_logo_colors,bannerTitle:data.banner_title,bannerSubtitle:data.banner_subtitle,primaryColor:data.primary_color,buttonColor:data.button_color||'#16834b',accentColor:data.accent_color,pageBackgroundColor:data.page_background_color||'#ffffff',surfaceColor:data.surface_color||'#ffffff',textColor:data.text_color||'#25372c',whatsappPublic:data.whatsapp_public,instagramUrl:data.instagram_url,addressText:data.address_text,businessHours:data.business_hours,deliveryInfo:data.delivery_info,defaultDeliveryFeeCents:parseBRLToCents(data.defaultFeeDisplay||'0'),freeDeliveryMinCents:data.freeFeeDisplay?parseBRLToCents(data.freeFeeDisplay):null,minOrderCents:parseBRLToCents(data.minOrderDisplay||'0'),isOpen:!!data.is_open,acceptsCash:!!data.accepts_cash,acceptsPixDelivery:!!data.accepts_pix_delivery,acceptsDebitDelivery:!!data.accepts_debit_delivery,acceptsCreditDelivery:!!data.accepts_credit_delivery,signupPopupEnabled:!!data.signup_popup_enabled,signupPopupEmojis:data.signup_popup_emojis,signupPopupEyebrow:data.signup_popup_eyebrow,signupPopupTitle:data.signup_popup_title,signupPopupDescription:data.signup_popup_description,signupPopupButton:data.signup_popup_button,signupPopupNameLabel:data.signup_popup_name_label,signupPopupEmailLabel:data.signup_popup_email_label,signupPopupPhoneLabel:data.signup_popup_phone_label,signupPopupPrivacyConsent:data.signup_popup_privacy_consent,signupPopupMarketingConsent:data.signup_popup_marketing_consent,signupPopupPrivacyNote:data.signup_popup_privacy_note,receiptFooter:data.receipt_footer||'',receiptWatermarkText:data.receipt_watermark_text||'',receiptWatermarkOrientation:data.receipt_watermark_orientation||'diagonal',receiptWatermarkOpacity:Number(data.receipt_watermark_opacity??10),receiptWatermarkFontSize:Number(data.receipt_watermark_font_size??21),deliveryEtaText:data.delivery_eta_text||'30 a 40 minutos',openingSchedule:readSchedule(data.opening_schedule_json)})},token);setSaved(true);window.dispatchEvent(new CustomEvent('store-status',{detail:getStoreStatus(!!data.is_open,data.opening_schedule_json,new Date(),data.business_hours).open}));}catch(e:any){setError(e.message);}}return <><PageHead eyebrow="IDENTIDADE E ENTREGA" title="Configurações" desc="Personalize sua loja e as condições de venda." action={<button className="btn btn-primary" onClick={save} disabled={!!uploading}><Check size={16}/> Salvar alterações</button>}/>{error&&<div className="error-banner">{error}</div>}{mediaNotice&&<div className="success-banner" role="status">{mediaNotice}</div>}{saved&&<div className="success-banner">Configurações salvas. A vitrine já foi atualizada.</div>}<div className="settings-grid"><div className="settings-main"><section className="panel-card settings-card"><div className="panel-heading"><div><h2>Identidade da loja</h2><p>Como seus clientes veem o estabelecimento.</p></div><Store size={19}/></div><div className="form-grid"><label className="full">Nome comercial<input value={data.name||''} onChange={e=>set('name',e.target.value)}/></label><label className="full">Logomarca da loja
<input type="file" accept={IMAGE_ACCEPT} disabled={!!uploading} onChange={e=>uploadBrandImage(e,'logo_url')}/>
<small className="image-upload-hint">{uploading==='logo_url'?(uploadStage||'Enviando logomarca…'):'Escolha uma imagem do aparelho (PNG, JPG, WebP, AVIF, GIF ou outra compatível). A vitrine é atualizada automaticamente.'}</small>
{data.logo_url&&<img className="upload-preview store-logo-preview" src={data.logo_url} alt="Prévia da logomarca escolhida"/>}</label>{data.logo_url&&<div className="full brand-logo-removal"><button type="button" className="btn btn-danger-soft" disabled={!!uploading} onClick={removeBrandLogo}><Trash2 size={16}/> {uploading==='logo_url'?'Atualizando logomarca…':'Remover logomarca'}</button><small>Remove a imagem da vitrine e da comanda, sem alterar pedidos ou outras lojas.</small></div>}<label>Cor principal<input aria-label="Cor principal da vitrine" type="color" value={data.primary_color||'#16834b'} onChange={e=>set('primary_color',e.target.value)}/><small className="color-setting-hint">Ícones, categorias selecionadas, links e elementos da identidade.</small></label><label>Cor dos botões<input aria-label="Cor dos botões da vitrine" type="color" value={data.button_color||'#16834b'} onChange={e=>set('button_color',e.target.value)}/><small className="color-setting-hint">Adicionar, finalizar pedido, carrinho e ações principais.</small></label><label>Cor de destaque<input aria-label="Cor de destaque da vitrine" type="color" value={data.accent_color||'#ea580c'} onChange={e=>set('accent_color',e.target.value)}/><small className="color-setting-hint">Ofertas, descontos e etiquetas promocionais.</small></label><label>Fundo da loja<input aria-label="Cor do fundo da vitrine" type="color" value={data.page_background_color||'#ffffff'} onChange={e=>set('page_background_color',e.target.value)}/><small className="color-setting-hint">Fundo geral da página pública.</small></label><label>Fundo dos cartões<input aria-label="Cor dos cartões da vitrine" type="color" value={data.surface_color||'#ffffff'} onChange={e=>set('surface_color',e.target.value)}/><small className="color-setting-hint">Cartões de produtos, carrinho e áreas de conteúdo.</small></label><label>Cor dos textos<input aria-label="Cor dos textos da vitrine" type="color" value={data.text_color||'#25372c'} onChange={e=>set('text_color',e.target.value)}/><small className="color-setting-hint">Textos principais, títulos e nomes dos produtos.</small></label><div className="full logo-colors-option"><div className="settings-toggle"><span><b>Usar cores da minha logomarca</b><small>Aplicar automaticamente a paleta extraída da imagem na vitrine pública.</small></span><label className="switch"><input type="checkbox" checked={!!data.use_logo_colors} disabled={!data.logo_palette_json} onChange={e=>set('use_logo_colors',e.target.checked?1:0)}/><span/></label></div>{!data.logo_palette_json?<small className="color-setting-hint">Envie uma logomarca para identificar e preparar a paleta automaticamente.</small>:<><div className="logo-palette-swatches">{Object.entries(readLogoPalette(data.logo_palette_json)||{}).map(([name,color])=><span key={name} title={name} style={{background:String(color)}}/> )}</div><small className="color-setting-hint">{data.use_logo_colors?'A vitrine está usando as cores da logomarca.':'Paleta identificada e salva. Ative a opção para aplicá-la.'}</small></>}</div><p className="full color-settings-note">Personalize cada parte da vitrine. As alterações aparecem depois de clicar em <b>Salvar alterações</b> e não afetam outras lojas.</p><label className="full">Título abaixo do banner<input value={data.banner_title||''} onChange={e=>set('banner_title',e.target.value)}/></label><label className="full">Subtítulo abaixo do banner<input value={data.banner_subtitle||''} onChange={e=>set('banner_subtitle',e.target.value)}/></label></div></section><CarouselManager token={token}/><section className="panel-card settings-card"><div className="panel-heading"><div><h2>Contato e funcionamento</h2><p>Informações exibidas na vitrine.</p></div><Phone size={19}/></div><div className="form-grid"><label>WhatsApp público<input value={data.whatsapp_public||''} onChange={e=>set('whatsapp_public',e.target.value)}/></label><label>Instagram URL<input value={data.instagram_url||''} onChange={e=>set('instagram_url',e.target.value)}/></label><label className="full">Endereço comercial<input value={data.address_text||''} onChange={e=>set('address_text',e.target.value)}/></label><label className="full">Horário de funcionamento<input value={data.business_hours||''} onChange={e=>set('business_hours',e.target.value)} placeholder="Seg a Sáb: 07h às 19h • Dom: 07h às 13h"/><small className="hours-source-hint">Este horário controla automaticamente a abertura e o fechamento, quando os horários detalhados não estiverem ativos. Exemplo: Seg a Sáb: 07h às 19h • Dom: 07h às 13h.</small></label><label className="full">Informações de entrega<textarea value={data.delivery_info||''} onChange={e=>set('delivery_info',e.target.value)}/></label></div></section></div><div className="settings-side">
  <section className="panel-card settings-card"><div className="panel-heading"><div><h2>Personalizar comanda</h2><p>Mensagem impressa no rodapé. Deixe vazia para economizar papel.</p></div><Printer size={18}/></div><label>Mensagem do rodapé<textarea maxLength={300} rows={3} placeholder="Obrigado pela preferência!" value={data.receipt_footer||''} onChange={e=>set('receipt_footer',e.target.value)}/></label></section>
  <section className="panel-card settings-card">
   <div className="panel-heading"><div><h2>Marca-d'água da comanda</h2><p>Personalize o texto e a posição sem alterar o restante da impressão.</p></div><Printer size={18}/></div>
   <label>Texto da marca-d'água<input maxLength={100} value={data.receipt_watermark_text||''} onChange={e=>set('receipt_watermark_text',e.target.value)} placeholder={data.name||'Nome da loja'}/></label>
   <small>Se deixar vazio, será usada a logomarca da loja ou o nome do estabelecimento.</small>
   <label>Orientação<select value={data.receipt_watermark_orientation||'diagonal'} onChange={e=>set('receipt_watermark_orientation',e.target.value)}>
    <option value="horizontal">Horizontal</option><option value="diagonal">Diagonal</option><option value="vertical">Vertical</option>
   </select></label>
   <label>Opacidade: {data.receipt_watermark_opacity??10}%<input type="range" min="0" max="35" step="1" value={data.receipt_watermark_opacity??10} onChange={e=>set('receipt_watermark_opacity',Number(e.target.value))}/></label>
   <label>Tamanho: {data.receipt_watermark_font_size??21} pt<input type="range" min="10" max="48" step="1" value={data.receipt_watermark_font_size??21} onChange={e=>set('receipt_watermark_font_size',Number(e.target.value))}/></label>
   <div className="receipt-watermark-preview" aria-label="Prévia da marca-d'água"><span className={`preview-${data.receipt_watermark_orientation||'diagonal'}`} style={{opacity:(data.receipt_watermark_opacity??10)/100,fontSize:`${data.receipt_watermark_font_size??21}px`}}>{(data.receipt_watermark_text||data.name||'NOME DA LOJA').trim()}</span></div>
   <small>A prévia é ilustrativa. As opções serão aplicadas às próximas comandas impressas desta loja.</small>
  </section>
  <section className="panel-card settings-card"><h2>Previsão de entrega</h2><label>Tempo estimado para o WhatsApp<input maxLength={80} value={data.delivery_eta_text||''} onChange={e=>set('delivery_eta_text',e.target.value)} placeholder="30 a 40 minutos"/></label><small>Enviada quando o pedido for aceito.</small></section>
  <section className="panel-card settings-card">
    <div className="panel-heading"><div><h2>🍓 Convite de cadastro</h2><p>Pop-up que aparece na entrada da sua vitrine, sem oferecer cupons.</p></div><Users size={18}/></div>
    <label className="settings-toggle"><span><b>Ativar pop-up</b><small>Os dados ficam somente nesta loja</small></span><label className="switch"><input type="checkbox" checked={!!data.signup_popup_enabled} onChange={e=>set('signup_popup_enabled',e.target.checked?1:0)}/><span/></label></label>
    <label>Emojis do topo<input maxLength={80} value={data.signup_popup_emojis||'🛒 🍎 📦'} onChange={e=>set('signup_popup_emojis',e.target.value)} placeholder="🛒 🍎 📦"/></label><label>Texto pequeno acima do título<input maxLength={110} value={data.signup_popup_eyebrow||''} onChange={e=>set('signup_popup_eyebrow',e.target.value)}/></label><label>Título do convite<input maxLength={110} value={data.signup_popup_title||''} onChange={e=>set('signup_popup_title',e.target.value)}/></label>
    <label>Mensagem exibida<textarea maxLength={300} rows={3} value={data.signup_popup_description||''} onChange={e=>set('signup_popup_description',e.target.value)}/></label>
    <label>Texto do botão<input maxLength={110} value={data.signup_popup_button||''} onChange={e=>set('signup_popup_button',e.target.value)}/></label><label>Rótulo do campo nome<input maxLength={80} value={data.signup_popup_name_label||'Nome completo'} onChange={e=>set('signup_popup_name_label',e.target.value)}/></label><label>Rótulo do campo e-mail<input maxLength={80} value={data.signup_popup_email_label||'E-mail'} onChange={e=>set('signup_popup_email_label',e.target.value)}/></label><label>Rótulo do campo celular<input maxLength={100} value={data.signup_popup_phone_label||'Celular com WhatsApp e DDD'} onChange={e=>set('signup_popup_phone_label',e.target.value)}/></label><label>Texto do consentimento de cadastro<textarea maxLength={300} rows={3} value={data.signup_popup_privacy_consent||'Autorizo o cadastro de meus dados nesta loja para identificação e contato relacionado ao meu cadastro.'} onChange={e=>set('signup_popup_privacy_consent',e.target.value)}/></label><label>Texto da autorização de ofertas (opcional)<textarea maxLength={300} rows={3} value={data.signup_popup_marketing_consent||'Quero receber novidades e ofertas por WhatsApp e e-mail (opcional).'} onChange={e=>set('signup_popup_marketing_consent',e.target.value)}/></label><label>Texto de privacidade no rodapé<textarea maxLength={300} rows={3} value={data.signup_popup_privacy_note||'Seus dados ficam vinculados somente a {loja}. Você escolhe se quer receber novidades e pode solicitar atualização ou exclusão à loja.'} onChange={e=>set('signup_popup_privacy_note',e.target.value)}/><small>Use {`{loja}`} para inserir automaticamente o nome do estabelecimento.</small></label>
    <small>O cliente poderá fechar o convite. O consentimento para receber ofertas será opcional e ficará registrado na lista Clientes.</small>
  </section>
  <section className="panel-card settings-card"><div className="panel-heading"><div><h2>Entrega</h2><p>Taxa padrão e pedido mínimo</p></div><Truck size={19}/></div><label>Taxa padrão de entrega (R$)<input inputMode="decimal" value={data.defaultFeeDisplay} onChange={e=>set('defaultFeeDisplay',e.target.value)}/></label><label>Frete grátis a partir de (R$)<input inputMode="decimal" value={data.freeFeeDisplay} onChange={e=>set('freeFeeDisplay',e.target.value)}/></label><label>Pedido mínimo (R$)<input inputMode="decimal" value={data.minOrderDisplay} onChange={e=>set('minOrderDisplay',e.target.value)}/></label></section><section className="panel-card settings-card"><div className="panel-heading"><div><h2>Pagamentos aceitos na entrega</h2><p>Nenhum pagamento online.</p></div></div>{[['accepts_cash','Dinheiro'],['accepts_pix_delivery','Pix na entrega'],['accepts_debit_delivery','Cartão de débito'],['accepts_credit_delivery','Cartão de crédito']].map(([k,l])=><label className="settings-toggle" key={k}><span>{l}</span><label className="switch"><input type="checkbox" checked={!!data[k]} onChange={e=>set(k,e.target.checked?1:0)}/><span/></label></label>)}</section><section className="panel-card settings-card"><div className="settings-toggle"><span><b>Permitir funcionamento da loja</b><small>Desative para fechar manualmente, mesmo dentro do horário automático.</small></span><label className="switch"><input type="checkbox" checked={!!data.is_open} onChange={e=>set('is_open',e.target.checked?1:0)}/><span/></label></div><StoreScheduleEditor value={typeof data.opening_schedule_json==='object'&&data.opening_schedule_json?data.opening_schedule_json:readSchedule(data.opening_schedule_json)} onChange={v=>set('opening_schedule_json',v)} manualOpen={!!data.is_open} businessHours={data.business_hours||''}/></section><section className="panel-card settings-card"><div className="panel-heading"><div><h2>Bairros atendidos</h2><p>Configure regiões e taxas de entrega.</p></div><MapPin size={17}/></div>{(data.neighborhoods||[]).map((n:any)=><div className="neighborhood-row" key={n.id}><span><b>{n.name}</b><small>{money(n.delivery_fee_cents)} · {n.estimated_time}</small></span><div className="neighborhood-actions"><button className="icon-btn" title="Editar bairro e taxa" onClick={async()=>{const name=window.prompt('Nome do bairro:',n.name);if(name===null)return;const fee=window.prompt('Taxa de entrega em reais (ex.: 6,00):',(Number(n.delivery_fee_cents)/100).toFixed(2).replace('.',','));if(fee===null)return;try{await req(`/admin/settings/neighborhoods/${n.id}`,{method:'PATCH',body:JSON.stringify({name,deliveryFeeCents:parseBRLToCents(fee)})},token);const x=await req('/admin/settings',{},token);set('neighborhoods',x.neighborhoods);}catch(e:any){setError(e.message);}}}><Settings size={14}/></button><button className="icon-btn" title="Remover bairro" onClick={async()=>{await req(`/admin/settings/neighborhoods/${n.id}`,{method:'DELETE'},token);set('neighborhoods',data.neighborhoods.filter((x:any)=>x.id!==n.id));}}><X size={15}/></button></div></div>)}<div className="neighborhood-add"><input placeholder="Novo bairro" value={data.newNeighborhoodName||''} onChange={e=>set('newNeighborhoodName',e.target.value)}/><input placeholder="Taxa (R$)" inputMode="decimal" value={data.newNeighborhoodFee||''} onChange={e=>set('newNeighborhoodFee',e.target.value)}/><button className="btn btn-xs btn-outline" onClick={async()=>{if(!data.newNeighborhoodName)return;try{await req('/admin/settings/neighborhoods',{method:'POST',body:JSON.stringify({name:data.newNeighborhoodName,deliveryFeeCents:parseBRLToCents(data.newNeighborhoodFee||'0')})},token);const x=await req('/admin/settings',{},token);setData({...data,neighborhoods:x.neighborhoods,newNeighborhoodName:'',newNeighborhoodFee:0});}catch(e:any){setError(e.message);}}}><Plus size={13}/></button></div></section></div></div></>}
type NewExpressAccess={
 tenantId:string; slug:string; name:string; ownerEmail:string;
 temporaryPassword:string; adminUrl:string; storeUrl:string;
 domainStatus:'registered'|'pending'|'manual'; domainMessage:string;
};
function SuperAdmin(){
 const [token,setToken]=useState(localStorage.getItem('crj_token')||'');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [data,setData]=useState<any[]>([]);
 const [error,setError]=useState('');
 const [modal,setModal]=useState(false);
 const [creating,setCreating]=useState(false);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [domainRetryId,setDomainRetryId]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [access,setAccess]=useState<NewExpressAccess|null>(null);
 const [showAccessPassword,setShowAccessPassword]=useState(false);
 const [copied,setCopied]=useState('');
 const [form,setForm]=useState<any>({name:'',slug:'',ownerName:'',ownerEmail:'',temporaryPassword:'',saleModes:['weight','unit','dual','variants','custom']});
 async function login(e:React.FormEvent){
  e.preventDefault();
  setError('');
  try{
   const x=await req('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
   if(x.user.role!=='superadmin')throw Error('Este usuário não é Super-Admin.');
   localStorage.setItem('crj_token',x.token);
   setToken(x.token);
   setPassword('');
  }catch(err:any){setError(err.message);}
 }
 async function load(){
  const x=await req('/superadmin/tenants',{},token);
  setData(x.tenants||[]);
 }
 useEffect(()=>{if(token)void load().catch(err=>setError(err.message));},[token]);
 async function create(e:React.FormEvent){
  e.preventDefault();
  if(creating)return;
  setError('');
  setCreating(true);
  try{
   const created=await req('/superadmin/tenants',{
    method:'POST',body:JSON.stringify({...form,status:'active'})
   },token) as NewExpressAccess;
   setAccess(created);
   setNotice(created.domainStatus==='registered'?'Domínio registrado na Cloudflare. Confira o certificado HTTPS antes de divulgar.': 'Cadastro criado, mas a vitrine ainda não está pronta. Verifique o estado do domínio.');
   setShowAccessPassword(false);
   setCopied('');
   setForm({name:'',slug:'',ownerName:'',ownerEmail:'',temporaryPassword:'',saleModes:['weight','unit','dual','variants','custom']});
   setEditingId(null);
   setModal(false);
   void load().catch(err=>setError(err.message));
  }catch(err:any){setError(err.message);}
  finally{setCreating(false);}
 }
 async function editTenant(t:any){
  setError('');setEditingId(t.id);
  setForm({name:t.name,slug:t.slug,ownerName:t.owner_name||'',ownerEmail:t.owner_email||'',temporaryPassword:'',saleModes:t.saleModes||['weight','unit','dual','variants','custom']});
  setModal(true);
 }
 async function saveTenant(e:React.FormEvent){
  e.preventDefault();if(creating)return;if(!form.saleModes.length){setError('Selecione ao menos uma modalidade de venda.');return;}setCreating(true);setError('');
  try{
   if(editingId){await req('/superadmin/tenants/'+editingId,{method:'PATCH',body:JSON.stringify(form)},token);setNotice('Estabelecimento atualizado.');setModal(false);setEditingId(null);await load();}
   else await create(e);
  }catch(err:any){setError(err.message);}finally{setCreating(false);}
 }
 async function archiveTenant(t:any){
  if(!window.confirm('Arquivar '+t.name+'? A loja será bloqueada e removida da lista. Pedidos, clientes e histórico serão preservados.'))return;
  try{const result=await req('/superadmin/tenants/'+t.id,{method:'DELETE'},token);setNotice(result.message||'Estabelecimento arquivado.');await load();}catch(err:any){setError(err.message);}
 }
 async function retryDomain(t:any){
  if(domainRetryId)return;
  setDomainRetryId(t.id);setError('');setNotice('');
  try{
   const response=await req(`/superadmin/tenants/${t.id}/domain/retry`,{method:'POST',body:'{}'},token);
   setNotice(response.message||'Domínio registrado. Confirme HTTPS antes de divulgar.');
   await load();
  }catch(err:any){setError(err.message);await load().catch(()=>undefined);}
  finally{setDomainRetryId(null);}
 }
 async function copyValue(label:string,value:string){
  try{await navigator.clipboard.writeText(value);setCopied(label+' copiado com sucesso.');}
  catch{setCopied('Não foi possível copiar. Verifique a permissão do navegador.');}
 }
 const clearAccess=()=>{setAccess(null);setCopied('');setShowAccessPassword(false);};
 const logout=()=>{clearAccess();localStorage.removeItem('crj_token');setToken('');};
 if(!token)return <div className="login-screen"><div className="login-form-side">
  <form className="login-card" onSubmit={login}>
   <Link to="/" className="login-back"><ArrowLeft size={16}/> Início</Link>
   <div className="login-logo"><span className="brand-mark"><ShieldCheck/></span>
    <span>CR Jornada<small> EXPRESS</small></span></div>
   <span className="eyebrow">GESTÃO DOS ESTABELECIMENTOS</span>
   <h1>Super Admin do Express</h1>
   <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
   <label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
   {error&&<div className="error-banner">{error}</div>}
   <button className="btn btn-primary btn-block">Entrar no Super Admin</button>
  </form></div></div>;
 return <div className="super-page">
  <header className="super-top">
   <Link to="/" className="brand"><span className="brand-mark"><ShieldCheck/></span>CR Jornada <b>Express</b></Link>
   <button className="btn btn-outline" onClick={logout}>Sair</button>
  </header>
  <main className="super-content">
   <PageHead eyebrow="SUPER ADMINISTRADOR · EXPRESS" title="Estabelecimentos"
    desc="Gerencie exclusivamente os estabelecimentos do CR Jornada Express."
    action={<button className="btn btn-primary" onClick={()=>{setError('');setEditingId(null);setForm({name:'',slug:'',ownerName:'',ownerEmail:'',temporaryPassword:'',saleModes:['weight','unit','dual','variants','custom']});setModal(true);}}><Plus/> Novo estabelecimento</button>}/>
   {error&&<div className="error-banner" role="alert">{error}</div>}
   {notice&&<div className="success-banner" role="status">{notice}</div>}
   <div className="super-stats">
    <div><Store/><b>{data.length}</b><span>Estabelecimentos</span></div>
    <div><Check/><b>{data.filter(x=>x.status==='active').length}</b><span>Ativos</span></div>
    <div><DoorOpen/><b>{data.filter(x=>x.status!=='active').length}</b><span>Inativos ou bloqueados</span></div>
   </div>
   <div className="panel-card"><div className="table-wrap"><table>
    <thead><tr><th>Estabelecimento</th><th>Vitrine</th><th>Domínio</th><th>Status</th><th>Criado</th><th>Ações</th></tr></thead>
    <tbody>{data.map(t=><tr key={t.id}>
     <td><b>{t.name}</b><small className="cell-sub">{t.crm_external_id||t.id.slice(0,8)}</small></td>
     <td><b>{t.slug}</b><small className="cell-sub">
      <a href={storeHomeUrl(t.slug)} target="_blank" rel="noopener noreferrer">{storeHomeUrl(t.slug)}</a>
     </small></td>
     <td><span className="cell-sub">{t.domainStatus==='registered'
        ?'Registrado na Cloudflare':t.domainStatus==='conflict'?'Nome em conflito':
        t.domainStatus==='pending'?'Pendente de configuração':'Sem domínio automático'}</span>
      {t.domainStatus!=='registered'&&<button type="button" className="btn btn-xs btn-outline"
       disabled={domainRetryId===t.id} onClick={()=>void retryDomain(t)}>
       {domainRetryId===t.id?'Verificando…':'Tentar configurar domínio'}
      </button>}</td>
     <td><StatusBadge status={t.status==='active'?'accepted':'cancelled'}/></td>
     <td>{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
     <td><div className="action-row">
      <button className="btn btn-xs btn-outline" onClick={()=>editTenant(t)}>Editar</button>
      <button className="btn btn-xs btn-outline" onClick={async()=>{try{await req('/superadmin/tenants/'+t.id+'/status',{method:'PATCH',body:JSON.stringify({status:t.status==='active'?'blocked':'active',reason:'Ação pelo Super Admin Express'})},token);await load();}catch(err:any){setError(err.message);}}}>{t.status==='active'?'Bloquear':'Ativar'}</button>
      <button className="btn btn-xs btn-outline" onClick={()=>archiveTenant(t)}>Excluir</button>
     </div></td>
    </tr>)}</tbody>
   </table></div></div>
   {modal&&<div className="modal-backdrop"><form className="form-modal" onSubmit={saveTenant}>
    <div className="modal-heading"><div><span className="eyebrow">{editingId?"EDITAR ESTABELECIMENTO":"NOVO ESTABELECIMENTO"}</span>
      <h2>{editingId?"Editar estabelecimento":"Adicionar estabelecimento"}</h2></div>
     <button type="button" className="icon-btn" onClick={()=>setModal(false)} aria-label="Fechar cadastro"><X/></button></div>
    <div className="form-grid">
     <label>Nome comercial<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     {!editingId&&<label>Subdomínio da vitrine (.crjornada.com)<input required
      pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Use letras minúsculas, números ou hífens, sem espaços."
      value={form.slug}
      onChange={e=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')})}/></label>}
     <label>Nome do proprietário<input required value={form.ownerName}
      onChange={e=>setForm({...form,ownerName:e.target.value})}/></label>
     <label>E-mail de login do proprietário<input type="email" required value={form.ownerEmail}
      onChange={e=>setForm({...form,ownerEmail:e.target.value})}/></label>
     {!editingId&&<label>Senha inicial (opcional)<input minLength={12} autoComplete="new-password" type="password"
      value={form.temporaryPassword} onChange={e=>setForm({...form,temporaryPassword:e.target.value})}
      placeholder="Deixar vazio para gerar automaticamente"/></label> }
    </div>
    <div className="panel-card" style={{marginTop:12}}>
     <b>Modalidades de venda permitidas</b>
     <p className="integration-note">O proprietário só poderá usar as modalidades selecionadas. Ao habilitar Pizzaria, o catálogo também receberá categorias próprias para pizzas, lanches, bebidas, porções e combos; a loja poderá configurar sabores, tamanhos, bordas, adicionais e ingredientes removíveis.</p>
     <div className="form-grid">
      {[
       ['weight','Venda por peso'],['unit','Venda por unidade'],
       ['dual','Peso e unidade no mesmo produto'],['variants','Embalagens e variações'],
       ['custom','Produtos personalizáveis (complementos)'],['pizzeria','🍕 Modo Pizzaria (pizzas, lanches e bebidas)']
      ].map(([value,label]:any)=><label key={value} className="check-row">
       <input type="checkbox" checked={form.saleModes.includes(value)} onChange={e=>setForm({...form,saleModes:e.target.checked?[...form.saleModes,value]:form.saleModes.filter((x:string)=>x!==value)})}/>{label}
      </label>)}
     </div>
    </div>
    {!editingId&&<p className="integration-note">O sistema tentará registrar a vitrine na Cloudflare.
     Se houver erro, ela ficará pendente para nova tentativa. Os dados de acesso serão
     mostrados apenas uma vez. A troca de senha é opcional.</p>}
    {!editingId&&<p className="integration-note">Endereço desejado: {form.slug||'nomedaloja'}.crjornada.com.
     O cadastro automático precisa estar habilitado na configuração do Worker.</p>}
    {error&&<div className="error-banner">{error}</div>}
    <div className="modal-footer">
     <button type="button" className="btn btn-outline" onClick={()=>setModal(false)}>Cancelar</button>
     <button type="submit" className="btn btn-primary" disabled={creating}>{creating?(editingId?'Salvando…':'Criando…'):(editingId?'Salvar alterações':'Criar estabelecimento')}</button>
    </div>
   </form></div>}
   {access&&<div className="modal-backdrop"><div className="form-modal"
     role="dialog" aria-modal="true" aria-label="Credenciais do novo estabelecimento">
    <div className="modal-heading"><div><span className="eyebrow">CADASTRO CONCLUÍDO</span>
      <h2>Dados de acesso da loja</h2></div>
     <button className="icon-btn" aria-label="Fechar dados de acesso" onClick={clearAccess}><X/></button></div>
    <p className="integration-note">Copie os dados agora: a senha inicial não poderá ser consultada
     novamente. Ela não precisa ser alterada no primeiro acesso.</p>
    <p className={access.domainStatus==='registered'?'success-banner':'integration-note'} role="status">
     {access.domainMessage}</p>
    {([
     ['E-mail',access.ownerEmail],
     ['Senha inicial',showAccessPassword?access.temporaryPassword:'••••••••••••'],
     ['Painel do proprietário',access.adminUrl],
     ['Vitrine para os clientes',access.storeUrl]
    ] as [string,string][]).map(([label,value])=><div className="panel-card" key={label}
       style={{marginBottom:10,overflowWrap:'anywhere'}}>
      <b>{label}</b><p>{value}</p>
      <button type="button" className="btn btn-xs btn-outline"
       onClick={()=>void copyValue(label,label==='Senha inicial'?access.temporaryPassword:value)}>
       Copiar {label.toLowerCase()}
      </button>
      {label==='Senha inicial'&&<button type="button" className="btn btn-xs btn-outline"
       onClick={()=>setShowAccessPassword(v=>!v)}>{showAccessPassword?'Ocultar':'Mostrar'} senha</button>}
     </div>)}
    <button className="btn btn-primary btn-block" onClick={()=>void copyValue('Todas as informações',[
      'CR Jornada Express — '+access.name,
      'E-mail: '+access.ownerEmail,
      'Senha inicial: '+access.temporaryPassword,
      'Painel administrativo: '+access.adminUrl,
      'Vitrine da loja: '+access.storeUrl
     ].join('\n'))}>Copiar e-mail, senha e links</button>
    {copied&&<p role="status" className="integration-note">{copied}</p>}
    <div className="modal-footer"><button className="btn btn-outline" onClick={clearAccess}>
     Fechar e ocultar senha</button></div>
   </div></div>}
  </main>
 </div>;
}
