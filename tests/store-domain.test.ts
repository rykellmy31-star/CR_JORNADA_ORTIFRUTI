import {describe,it,expect} from 'vitest';
import {vanityStoreSlug,storeHomeUrl,isValidStoreSubdomain,hortifrutiHomeRoute,HORTIFRUTI_ADMIN_URL,HORTIFRUTI_SUPERADMIN_URL} from '../src/shared/store-domain';

describe('subdomínios de vitrines sem afetar serviços existentes',()=>{
 it('redireciona somente os dois hosts do Hortifruti para os seus painéis',()=>{
  expect(hortifrutiHomeRoute('hortifruti-admin.crjornada.com')).toBe('/superadmin');
  expect(hortifrutiHomeRoute('HORTIFRUTI.CRJORNADA.COM')).toBe('/admin');
  expect(hortifrutiHomeRoute('verdurao.crjornada.com')).toBeNull();
  expect(hortifrutiHomeRoute('admin.crjornada.com')).toBeNull();
  expect(HORTIFRUTI_ADMIN_URL).toBe('https://hortifruti.crjornada.com/admin');
  expect(HORTIFRUTI_SUPERADMIN_URL).toBe('https://hortifruti-admin.crjornada.com');
 });
 it('resolve o subdomínio do verdurão e preserva outros nomes',()=>{
  expect(vanityStoreSlug('verdurao.crjornada.com')).toBe('verdurao');
  expect(vanityStoreSlug('hortifruti-verde.crjornada.com')).toBe('hortifruti-verde');
  expect(vanityStoreSlug('admin.crjornada.com')).toBeNull();
  expect(vanityStoreSlug('hortifruti.crjornada.com')).toBeNull();
  expect(vanityStoreSlug('pontos.crjornada.com')).toBeNull();
  expect(vanityStoreSlug('crjornada.com')).toBeNull();
  expect(vanityStoreSlug('verdurao.exemplo.com')).toBeNull();
 });
 it('barra nomes reservados e inválidos',()=>{
  expect(isValidStoreSubdomain('admin')).toBe(false);
  expect(isValidStoreSubdomain('hortifruti')).toBe(false);
  expect(isValidStoreSubdomain('verdurão')).toBe(false);
  expect(isValidStoreSubdomain('loja--teste')).toBe(false);
  expect(storeHomeUrl('verdurao')).toBe('https://verdurao.crjornada.com/');
 });
});
