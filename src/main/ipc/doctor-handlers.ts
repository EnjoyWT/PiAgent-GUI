import { ipcMain } from 'electron'
import { getDoctorService } from '../doctor/doctor-service-singleton.ts'

export function setupDoctorHandlers(): void {
  const doctorService = getDoctorService()

  ipcMain.handle('doctor:list-domains', () => doctorService.listDomains())
  ipcMain.handle('doctor:list-components', (_, domain: string) =>
    doctorService.listComponents(domain)
  )
  ipcMain.handle('doctor:get-component-status', (_, domain: string, componentId: string) =>
    doctorService.getComponentStatus(domain, componentId)
  )
  ipcMain.handle('doctor:get-domain-summary', (_, domain: string) =>
    doctorService.getDomainSummary(domain)
  )
}
