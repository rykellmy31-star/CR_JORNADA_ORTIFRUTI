package com.crjornada.express.print;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class PrintService extends Service {
 public static final String ACTION_START="com.crjornada.express.print.START";
 public static final String ACTION_STOP="com.crjornada.express.print.STOP";
 private static final String CHANNEL="crx_print_connected";
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private volatile boolean running=false;
 private DeviceStore store;
 @Override public void onCreate(){
  super.onCreate();store=new DeviceStore(this);
  NotificationManager manager=getSystemService(NotificationManager.class);
  if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(
   new NotificationChannel(CHANNEL,"Impressão automática",NotificationManager.IMPORTANCE_LOW));
 }
 private Notification notification(){
  Intent open=new Intent(this,MainActivity.class);
  PendingIntent pending=PendingIntent.getActivity(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Intent stop=new Intent(this,PrintService.class).setAction(ACTION_STOP);
  PendingIntent stopIntent=PendingIntent.getService(this,2,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  return new Notification.Builder(this,CHANNEL)
   .setContentTitle("CR Jornada Express")
   .setContentText("Impressão automática ativa · aguardando pedidos")
   .setSmallIcon(R.drawable.ic_printer)
   .setContentIntent(pending)
   .setOngoing(true)
   .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"Parar",stopIntent).build())
   .build();
 }
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent!=null&&ACTION_STOP.equals(intent.getAction())){
   running=false;store.setShouldResumePrinting(false);store.setStatus("Impressão parada pelo usuário");
   stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;
  }
  if(store.token().isEmpty()||store.printerAddress().isEmpty()){
   store.setStatus("Pareie a loja e escolha uma impressora antes de iniciar");
   stopSelf();return START_NOT_STICKY;
  }
  if(Build.VERSION.SDK_INT>=34)
   startForeground(101,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
  else startForeground(101,notification());
  store.setShouldResumePrinting(true);
  if(!running){running=true;executor.execute(this::loop);}
  return START_STICKY;
 }
 private static String safeMessage(Exception ex){
  String msg=ex.getMessage()==null?ex.getClass().getSimpleName():ex.getMessage();
  return msg.length()>150?msg.substring(0,150):msg;
 }
 private void sleep(long delay){
  try{Thread.sleep(delay);}catch(InterruptedException ex){Thread.currentThread().interrupt();running=false;}
 }
 private void loop(){
  BackendClient client=new BackendClient();
  EscPosPrinter printer=new EscPosPrinter(this);
  while(running&&!Thread.currentThread().isInterrupted()){
   try{
    String token=store.token(),printerMac=store.printerAddress();
    if(token.isEmpty()||printerMac.isEmpty()){store.setStatus("Pareamento ou impressora não configurados");break;}
    JSONObject job=client.claim(token);
    if(job==null){store.setStatus("Conectado · aguardando novos pedidos");sleep(5000);continue;}
    String id=job.getString("id"),lease=job.getString("leaseToken");
    int orderNumber=job.getInt("orderNumber");
    if(store.alreadyPrinted(id)){
     // Já foi fisicamente enviado antes da falha de confirmação ao servidor.
     client.ack(token,id,lease,true,null);
     store.setStatus("Pedido #"+orderNumber+" já enviado; duplicação evitada");
     continue;
    }
    try{
     store.setStatus("Imprimindo pedido #"+orderNumber);
     printer.print(printerMac,job.getString("receiptText"));
     // Persiste antes de confirmar ao backend. Reinício após falha de rede não reimprime.
     store.markPrinted(id);
     client.ack(token,id,lease,true,null);
     store.setStatus("Pedido #"+orderNumber+" enviado à impressora");
    }catch(Exception printError){
     if(store.alreadyPrinted(id)){
      // Após o envio físico, falha apenas na confirmação HTTP: não declarar falha de impressão.
      store.setStatus("Pedido #"+orderNumber+" enviado; aguardando confirmação");
     }else{
      try{client.ack(token,id,lease,false,safeMessage(printError));}
      catch(Exception ignored){}
      store.setStatus("Falha no pedido #"+orderNumber+": "+safeMessage(printError));
      sleep(5000);
     }
    }
   }catch(Exception error){
    store.setStatus("Sem comunicação: "+safeMessage(error));
    sleep(6000);
   }
  }
  running=false;
 }
 @Override public void onDestroy(){
  running=false;executor.shutdownNow();store.setStatus("Serviço de impressão parado");super.onDestroy();
 }
 @Override public IBinder onBind(Intent intent){return null;}
}
