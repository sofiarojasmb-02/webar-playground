/**
 * physics.js - Motor de Físicas y Colisión/Rebote para Web AR
 * Simula la gravedad y el rebote elástico sobre una superficie (suelo real o virtual).
 */

class PhysicsEngine {
    constructor() {
        this.gravity = 9.8;        // Aceleración de la gravedad (m/s^2)
        this.elasticity = 0.6;     // Coeficiente de restitución (0 = sin rebote, 1 = rebote perfecto)
        this.dropHeight = 1.2;     // Altura inicial del lanzamiento (metros sobre el suelo)
        this.groundY = 0.0;        // Coordenada Y del suelo detectado (se actualiza dinámicamente)
        
        this.positionY = 0.0;      // Posición actual en Y
        this.velocityY = 0.0;      // Velocidad actual en Y
        this.isSimulating = false; // Estado de la simulación
    }

    /**
     * Inicia una caída libre desde la altura especificada.
     * @param {number} groundY - Coordenada Y del suelo sobre el que rebotar
     */
    startDrop(groundY = 0.0) {
        this.groundY = groundY;
        this.positionY = this.groundY + this.dropHeight;
        this.velocityY = 0.0;
        this.isSimulating = true;
        console.log(`Físicas iniciadas. Altura de caída: ${this.positionY}m, Altura suelo: ${this.groundY}m`);
    }

    /**
     * Detiene la simulación de físicas.
     */
    stop() {
        this.isSimulating = false;
        this.velocityY = 0.0;
    }

    /**
     * Actualiza el estado de las físicas usando integración de Euler.
     * @param {number} dt - Tiempo transcurrido en segundos (delta time)
     * @param {Function} onUpdate - Callback ejecutado con la nueva posición Y
     * @param {Function} onSettle - Callback ejecutado cuando el objeto se asienta en reposo
     */
    update(dt, onUpdate, onSettle) {
        if (!this.isSimulating) return;

        // Limitar dt para evitar saltos drásticos por caídas de frames
        const maxDt = 0.1;
        const actualDt = Math.min(dt, maxDt);

        // Integración de Euler
        // v = v + a * dt (gravedad hacia abajo, por tanto restamos)
        this.velocityY -= this.gravity * actualDt;
        // y = y + v * dt
        this.positionY += this.velocityY * actualDt;

        // Detección de colisión con el suelo (Y <= groundY)
        if (this.positionY <= this.groundY) {
            // Posicionar exactamente en el suelo
            this.positionY = this.groundY;

            // Invertir la velocidad con rebote elástico (restitución)
            this.velocityY = -this.velocityY * this.elasticity;

            // Si la velocidad resultante es extremadamente baja, detener la simulación (asentamiento)
            const velocityThreshold = 0.15; // Umbral en m/s
            if (this.velocityY < velocityThreshold) {
                this.velocityY = 0.0;
                this.positionY = this.groundY;
                this.isSimulating = false;
                if (onSettle) onSettle();
                console.log("El modelo se ha asentado en el suelo.");
            } else {
                // Micro-animación de rebote (disparar evento sonoro o visual si es necesario)
                console.log(`Rebote físico detectado. Velocidad de rebote: ${this.velocityY.toFixed(2)} m/s`);
            }
        }

        // Ejecutar callback de actualización con la nueva altura calculada
        if (onUpdate) {
            onUpdate(this.positionY);
        }
    }
}

// Exportar clase globalmente
window.PhysicsEngine = PhysicsEngine;
