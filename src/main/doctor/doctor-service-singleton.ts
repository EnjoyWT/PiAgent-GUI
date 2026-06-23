import { DoctorService } from './doctor-service.ts'

let doctorServiceSingleton: DoctorService | null = null

export const getDoctorService = (): DoctorService => {
  if (doctorServiceSingleton) return doctorServiceSingleton
  doctorServiceSingleton = new DoctorService()
  return doctorServiceSingleton
}
