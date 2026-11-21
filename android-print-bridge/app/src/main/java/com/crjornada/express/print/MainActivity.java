package com.crjornada.express.print;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class MainActivity extends Activity {
 private DeviceStore store;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private TextView status,deviceInfo,printerInfo,updateStatus;
 private volatile boolean updating=false;
 private File pendingInstall;
 private EditText slugInput,codeInput,nameInput;
 private final Runnable refresh=new Runnable(){@Override public void run(){
  if(status!=null)status.setText("Estado: "+store.status());
  handler.postDelayed(this,2500);
 }};
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private TextView text(String s,int size,boolean bold){
  TextView v=new TextView(this);v.setText(s);v.setTextSize(size);v.setPadding(0,dp(7),0,dp(7));
  if(bold)v.setTypeface(null,1);return v;
 }
 private EditText edit(LinearLayout layout,String label,String hint,String initial){
  layout.addView(text(label,13,true));
  EditText e=new EditText(this);e.setSingleLine(true);e.setTextSize(15);e.setHint(hint);e.setText(initial);
  layout.addView(e,new LinearLayout.LayoutParams(-1,dp(50)));return e;
 }
 private Button button(LinearLayout parent,String label,View.OnClickListener listener){
  Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setOnClickListener(listener);
  LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(52));p.topMargin=dp(8);
  parent.addView(b,p);return b;
 }
 @Override public void onCreate(Bundle savedInstanceState){
  super.onCreate(savedInstanceState);
  store=new DeviceStore(this);
  ScrollView scroll=new ScrollView(this);
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
  root.setPadding(dp(24),dp(24),dp(24),dp(36));
  scroll.addView(root);setContentView(scroll);
  root.addView(text("CR JORNADA EXPRESS",24,true));
  root.addView(text("Impressão automática Android · Bluetooth ESC/POS 58 mm",14,false));
  root.addView(text("1. PAREAR A LOJA",18,true));
  slugInput=edit(root,"Subdomínio da loja (sem .crjornada.com)","verdurao-itanhem",store.slug());
  codeInput=edit(root,"Código exibido no painel > Impressoras","ABCD-EF12-3456-7890","");
  nameInput=edit(root,"Nome para identificar este celular","Balcão principal",Build.MANUFACTURER+" "+Build.MODEL);
  button(root,"Parear este Android",view->pair());
  deviceInfo=text("",12,false);root.addView(deviceInfo);
  root.addView(text("2. SELECIONAR IMPRESSORA",18,true));
  printerInfo=text("",12,false);root.addView(printerInfo);
  button(root,"Escolher impressora Bluetooth já pareada",view->choosePrinter());
  root.addView(text("Se a impressora não aparecer, faça o pareamento primeiro nas Configurações > Bluetooth do Android.",12,false));
  root.addView(text("3. IMPRESSÃO AUTOMÁTICA",18,true));
  button(root,"Iniciar serviço de impressão",view->startPrint());
  button(root,"Parar impressão",view->stopPrint());
  status=text("",13,true);root.addView(status);
  button(root,"Desvincular este Android da loja",view->unpair());
  root.addView(text("4. ATUALIZAÇÕES DO APLICATIVO",18,true));
  updateStatus=text("Verificando versão instalada…",12,false);root.addView(updateStatus);
  button(root,"Buscar atualizações",view->checkUpdates(true));
  root.addView(text("O aplicativo procura versões novas automaticamente e mostra uma notificação. "+
   "Quando uma atualização estiver disponível, você poderá baixar e confirmar a instalação sem procurar outro APK.",12,false));
  root.addView(text("O serviço exibe uma notificação permanente enquanto estiver ativo. O celular precisa manter Bluetooth e internet ligados. A impressão física depende do modelo ESC/POS.",12,false));
  askPermissions();refreshDisplay();
 }
 @Override protected void onResume(){
  super.onResume();refreshDisplay();handler.removeCallbacks(refresh);handler.post(refresh);
  if(pendingInstall!=null && pendingInstall.isFile() &&
   (Build.VERSION.SDK_INT<26||getPackageManager().canRequestPackageInstalls())){
   try{
    AndroidUpdater.requestInstall(this,pendingInstall);pendingInstall=null;
   }catch(Exception ex){message("Falha ao abrir instalador: "+ex.getMessage());}
  }
  boolean fromNotification=getIntent().getBooleanExtra("CHECK_UPDATE_NOW",false);
  if(fromNotification)getIntent().removeExtra("CHECK_UPDATE_NOW");
  checkUpdates(fromNotification);
 }
 @Override protected void onPause(){handler.removeCallbacks(refresh);super.onPause();}
 @Override protected void onNewIntent(Intent intent){
  super.onNewIntent(intent);
  setIntent(intent);
  if(intent!=null&&intent.getBooleanExtra("CHECK_UPDATE_NOW",false)){
   intent.removeExtra("CHECK_UPDATE_NOW");checkUpdates(true);
  }
 }
 private void refreshDisplay(){
  if(deviceInfo!=null)deviceInfo.setText(store.token().isEmpty()?"Loja não pareada":"Vinculado: "+store.storeName()+" ("+store.slug()+")");
  if(printerInfo!=null)printerInfo.setText(store.printerAddress().isEmpty()?"Impressora: não selecionada":"Impressora: "+store.printerAddress());
  if(status!=null)status.setText("Estado: "+store.status());
 }
 private void askPermissions(){
  List<String> needed=new ArrayList<>();
  if(Build.VERSION.SDK_INT>=31&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)
   needed.add(Manifest.permission.BLUETOOTH_CONNECT);
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
   needed.add(Manifest.permission.POST_NOTIFICATIONS);
  if(!needed.isEmpty())requestPermissions(needed.toArray(new String[0]),100);
 }
 private boolean bluetoothAllowed(){
  if(Build.VERSION.SDK_INT>=31&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED){
   askPermissions();message("Autorize o Bluetooth e tente novamente.");return false;
  }return true;
 }
 private void message(String s){new AlertDialog.Builder(this).setMessage(s).setPositiveButton("OK",null).show();}
 private void pair(){
  String slug=slugInput.getText().toString().trim().toLowerCase();
  String code=codeInput.getText().toString().trim();
  String name=nameInput.getText().toString().trim();
  if(!slug.matches("[a-z0-9]+(-[a-z0-9]+)*")||code.length()<16||name.length()<2){
   message("Informe o subdomínio, o código de pareamento e o nome deste Android.");return;
  }
  store.setStatus("Vinculando o celular…");refreshDisplay();
  new Thread(()->{
   try{
    var result=new BackendClient().pair(slug,code,name);
    store.pair(slug,result.getString("deviceId"),result.getString("deviceToken"),result.getString("storeName"));
    store.setStatus("Android pareado. Escolha a impressora e inicie o serviço.");
    runOnUiThread(()->{codeInput.setText("");refreshDisplay();message("Celular vinculado à loja com sucesso!");});
   }catch(Exception ex){
    store.setStatus("Falha no pareamento");
    runOnUiThread(()->{refreshDisplay();message("Não foi possível parear: "+ex.getMessage());});
   }
  }).start();
 }
 private void choosePrinter(){
  if(!bluetoothAllowed())return;
  BluetoothManager manager=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);
  BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
  if(adapter==null||!adapter.isEnabled()){
   message("Ative o Bluetooth do Android para escolher a impressora.");return;
  }
  Set<BluetoothDevice> bonded=adapter.getBondedDevices();
  if(bonded.isEmpty()){
   new AlertDialog.Builder(this).setTitle("Nenhuma impressora pareada")
    .setMessage("Pareie a impressora pelo Bluetooth do sistema Android e volte aqui.")
    .setPositiveButton("Abrir Bluetooth",(dialog,which)->startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)))
    .setNegativeButton("Cancelar",null).show();return;
  }
  List<BluetoothDevice> devices=new ArrayList<>(bonded);
  String[] names=new String[devices.size()];
  for(int i=0;i<devices.size();i++){
   String name=devices.get(i).getName();
   names[i]=(name==null?"Bluetooth":name)+" · "+devices.get(i).getAddress();
  }
  new AlertDialog.Builder(this).setTitle("Selecione a impressora ESC/POS")
   .setItems(names,(dialog,which)->{
    store.setPrinterAddress(devices.get(which).getAddress());
    refreshDisplay();
   }).setNegativeButton("Cancelar",null).show();
 }
 private void startPrint(){
  if(store.token().isEmpty()){message("Primeiro vincule este Android ao estabelecimento.");return;}
  if(store.printerAddress().isEmpty()){message("Escolha uma impressora Bluetooth.");return;}
  if(!bluetoothAllowed())return;
  try{
   Intent intent=new Intent(this,PrintService.class).setAction(PrintService.ACTION_START);
   if(Build.VERSION.SDK_INT>=26)startForegroundService(intent);else startService(intent);
   store.setStatus("Iniciando impressão automática…");refreshDisplay();
  }catch(Exception ex){message("Não foi possível iniciar o serviço: "+ex.getMessage());}
 }
 private void stopPrint(){
  Intent intent=new Intent(this,PrintService.class).setAction(PrintService.ACTION_STOP);
  startService(intent);store.setStatus("Impressão parada pelo usuário");refreshDisplay();
 }
 private void updateInfo(String value){
  if(updateStatus!=null)updateStatus.setText(value);
 }
 private void checkUpdates(boolean manual){
  if(updating){if(manual)message("Já existe uma consulta de atualização em andamento.");return;}
  if(!manual&&System.currentTimeMillis()-store.lastUpdateCheckedAt()<6L*60*60*1000)return;
  updating=true;
  updateInfo("Procurando atualização oficial do Express…");
  new Thread(()->{
   try{
    AndroidUpdater.Update latest=AndroidUpdater.check();
    int current=AndroidUpdater.installedCode(this);
    String version=AndroidUpdater.installedVersion(this);
    store.markUpdateChecked();
    runOnUiThread(()->{
     updating=false;
     if(latest==null||latest.versionCode<=current){
      updateInfo("Versão "+version+" · aplicativo atualizado.");
      if(manual)message("Você já está usando a versão mais recente disponível.");
     }else{
      updateInfo("Nova versão "+latest.versionName+" disponível! Sua versão: "+version);
      new AlertDialog.Builder(this)
       .setTitle("Atualização disponível")
       .setMessage("Nova versão "+latest.versionName+
        " do CR Jornada Express Impressão. Deseja baixar a atualização agora?")
       .setPositiveButton("Baixar e atualizar",(dialog,which)->downloadUpdate(latest))
       .setNegativeButton("Depois",null).show();
     }
    });
   }catch(Exception ex){
    runOnUiThread(()->{
     updating=false;updateInfo("Não foi possível consultar atualizações.");
     if(manual)message("Erro na busca de atualizações: "+ex.getMessage());
    });
   }
  }).start();
 }
 private void downloadUpdate(AndroidUpdater.Update latest){
  if(updating)return;
  updating=true;updateInfo("Baixando e verificando a atualização…");
  new Thread(()->{
   try{
    File apk=AndroidUpdater.downloadAndVerify(this,latest);
    runOnUiThread(()->{
     updating=false;pendingInstall=apk;
     updateInfo("Atualização verificada. Confirme a instalação no Android.");
     try{
      if(AndroidUpdater.requestInstall(this,apk))pendingInstall=null;
      else message("Autorize a instalação de atualizações deste aplicativo nas configurações. "+
       "Ao voltar, a instalação será oferecida automaticamente.");
     }catch(Exception ex){message("Não foi possível abrir o instalador: "+ex.getMessage());}
    });
   }catch(Exception ex){
    runOnUiThread(()->{
     updating=false;updateInfo("Falha ao baixar ou verificar a atualização.");
     message("Atualização não instalada: "+ex.getMessage());
    });
   }
  }).start();
 }
 private void unpair(){
  if(store.token().isEmpty()){message("Nenhum dispositivo vinculado.");return;}
  new AlertDialog.Builder(this).setTitle("Desvincular Android?")
   .setMessage("Pare primeiro o serviço. O proprietário também deve revogar este dispositivo no painel.")
   .setPositiveButton("Desvincular",(dialog,which)->{
    stopPrint();store.unpair();refreshDisplay();
   }).setNegativeButton("Cancelar",null).show();
 }
}
