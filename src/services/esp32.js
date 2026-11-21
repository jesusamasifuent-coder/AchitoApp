
const ESP32_IP = 'http://192.168.1.100'

export async function getStatus() {
  try {
    const response = await fetch(`${ESP32_IP}/status`, {
      signal: AbortSignal.timeout(3000)
    })

    if (!response.ok) {
      throw new Error('Error al consultar el ESP32')
    }

    const data = await response.json()

    if (
      typeof data.ldr !== 'number' ||
      typeof data.servo1 !== 'number' ||
      typeof data.servo2 !== 'number'
    ) {
      throw new Error('Respuesta inválida del ESP32')
    }

    return data

  } catch (error) {
    console.error('Error de conexión:', error)
    return null
  }
}
