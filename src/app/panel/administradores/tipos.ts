export type EstadoEnrolamiento = {
  error?: string;
  /** Se entrega una sola vez: solo vive en el estado de la acción, nunca en URL, cookie ni almacenamiento. */
  enrolamiento?: { email: string; secreto: string; qr: string; codigos: string[] };
};
