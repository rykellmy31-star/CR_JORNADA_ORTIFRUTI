package com.crjornada.express.print;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.UUID;

/** Bluetooth Classic SPP: ESC/POS 58 mm, 32 caracteres por linha (fonte A). */
public final class EscPosPrinter {
 private static final UUID SPP=UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
 private final Context context;
 public EscPosPrinter(Context context){this.context=context;}
 private static String printable(String text){
  String unaccented=Normalizer.normalize(text,Normalizer.Form.NFD)
   .replaceAll("\\p{M}+","");
  return unaccented.replaceAll("[^\\x20-\\x7E\\n]","?"); // Somente ASCII e quebras de linha
 }
 public void print(String mac,String receipt) throws Exception{
  if(!mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$"))
   throw new IOException("Endereço Bluetooth da impressora inválido.");
  if(Build.VERSION.SDK_INT>=31&&context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)
   throw new SecurityException("Permita a conexão Bluetooth nas configurações do Android.");
  BluetoothManager manager=(BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE);
  BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
  if(adapter==null||!adapter.isEnabled())throw new IOException("Bluetooth desligado ou indisponível.");
  BluetoothDevice device=adapter.getRemoteDevice(mac);
  try(BluetoothSocket socket=device.createRfcommSocketToServiceRecord(SPP)){
   socket.connect();
   OutputStream out=socket.getOutputStream();
   out.write(new byte[]{0x1b,0x40}); // ESC @: inicializar
   out.write(new byte[]{0x1b,0x61,0x00}); // ESC a 0: alinhar à esquerda
   String safe=printable(receipt);
   if(safe.length()>12_000)throw new IOException("Comanda maior que o limite de segurança.");
   out.write(safe.getBytes(StandardCharsets.US_ASCII));
   out.write(new byte[]{0x0a,0x0a,0x0a,0x0a});
   out.flush();
  }
 }
}
