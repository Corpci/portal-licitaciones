import { Portal } from './types';

export const INITIAL_PORTALS: Portal[] = [
  {
    id: 'edomex-procedimientos',
    name: 'Edomex - Procedimientos Adquisitivos',
    url: 'https://compramex.edomex.gob.mx/compramex/public/catalogosExternos/procedimientsoAdquisitivos.xhtml',
    status: 'active'
  },
  {
    id: 'cdmx-convocatorias',
    name: 'CDMX - Convocatorias Públicas',
    url: 'https://concursodigital.finanzas.cdmx.gob.mx/convocatorias_publicas#middle',
    status: 'active'
  },
  {
    id: 'bc-licitaciones',
    name: 'Baja California - Licitaciones',
    url: 'https://tramites.ebajacalifornia.gob.mx/Compras/Licitaciones',
    status: 'active'
  },
  {
    id: 'aguascalientes-estatales',
    name: 'Aguascalientes - Licitaciones Estatales',
    url: 'https://egobierno2.aguascalientes.gob.mx/servicios/LicitacionesEstatales/ui/dependencia.aspx?i=65',
    status: 'active'
  },
  {
    id: 'campeche-estatales',
    name: 'Campeche - Convocatorias Estatales',
    url: 'https://safin.campeche.gob.mx/convocatorias/estatales',
    status: 'active'
  },
  {
    id: 'chiapas-aop',
    name: 'Chiapas - Licitaciones AOP',
    url: 'https://www.puertochiapas.com.mx/licitaciones-aop',
    status: 'active'
  },
  {
    id: 'chihuahua-contrataciones',
    name: 'Chihuahua - Contrataciones',
    url: 'https://contrataciones.chihuahua.gob.mx/',
    status: 'active'
  },
  {
    id: 'colima-secop',
    name: 'Colima - SECOP',
    url: 'https://secop.col.gob.mx/',
    status: 'active'
  },
  {
    id: 'durango-procedimientos',
    name: 'Durango - Procedimientos de Contratación',
    url: 'https://comprasestatal.durango.gob.mx/consulta/ProcedimientosDeContratacion',
    status: 'active'
  },
  {
    id: 'jalisco-compras',
    name: 'Jalisco - Compras Público',
    url: 'https://difjalisco.gob.mx/compras-publico',
    status: 'active'
  }
];
