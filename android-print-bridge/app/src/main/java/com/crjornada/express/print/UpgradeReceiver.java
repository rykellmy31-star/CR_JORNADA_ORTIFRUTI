package com.crjornada.express.print;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Reinicia a ponte após atualização, somente se o usuário a havia deixado ativa. */
public final class UpgradeReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  if(intent==null||!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))return;
  DeviceStore store=new DeviceStore(context);
  if(!store.shouldResumePrinting()||store.token().isEmpty()||store.printerAddress().isEmpty())return;
  try{
   Intent resume=new Intent(context,PrintService.class).setAction(PrintService.ACTION_START);
   if(Build.VERSION.SDK_INT>=26)context.startForegroundService(resume);
   else context.startService(resume);
  }catch(Exception ex){
   store.setStatus("Atualização instalada. Abra o aplicativo para retomar a impressão.");
  }
 }
}
