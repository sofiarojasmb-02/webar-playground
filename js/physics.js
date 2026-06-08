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
        this.mass = 1.0;           // Masa del objeto en kg (0.1 a 10.0)
        this.friction = 0.1;       // Fricción / Resistencia del aire (0.0 a 4.0)
        
        this.positionY = 0.0;      // Posición actual en Y
        this.velocityY = 0.0;      // Velocidad actual en Y
        this.isSimulating = false; // Estado de la simulación
        this.lastImpactVelocity = 0.0; // Velocidad con la que impactó en el último rebote
        this.onCollision = null;   // Callback disparado al impactar con el suelo (recibe la velocidad de impacto)
    }

    /**
     * Inicia una caída libre desde la altura especificada.
     * @param {number} groundY - Coordenada Y del suelo sobre el que rebotar
     */
    startDrop(groundY = 0.0) {
        this.groundY = isNaN(groundY) ? 0.0 : groundY;
        this.positionY = this.groundY + (isNaN(this.dropHeight) ? 1.2 : this.dropHeight);
        this.velocityY = 0.0;
        this.isSimulating = true;
        console.log(`Físicas iniciadas. Altura de caída: ${this.positionY}m, Altura suelo: ${this.groundY}m`);
    }

    /**
     * Aplica un impulso vertical instantáneo (salto) al objeto.
     * @param {number} velocityY - Velocidad inicial hacia arriba (ej: 6.0 m/s)
     */
    applyImpulse(velocityY) {
        this.velocityY = velocityY;
        this.isSimulating = true;
        console.log(`Físicas: Impulso aplicado con velocidad Y de ${velocityY} m/s`);
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

        // Validar delta time contra NaN o valores inválidos
        if (isNaN(dt) || dt <= 0) return;

        // Validar propiedades físicas críticas contra NaN
        if (isNaN(this.gravity) || isNaN(this.elasticity) || isNaN(this.groundY) || isNaN(this.mass) || isNaN(this.friction)) {
            console.warn("Propiedades del motor de físicas contienen NaN. Deteniendo simulación.");
            this.stop();
            return;
        }

        // Limitar dt para evitar saltos drásticos por caídas de frames
        const maxDt = 0.1;
        const actualDt = Math.min(dt, maxDt);
        if (isNaN(actualDt) || actualDt <= 0) return;

        // Integración de Euler con masa y fricción (resistencia del aire)
        // Fuerza de arrastre (drag) = friction * velocityY
        // Aceleración de arrastre = (friction * velocityY) / mass
        // Aceleración total = -gravity - dragAcceleration
        const dragAcceleration = (this.friction * this.velocityY) / Math.max(0.01, this.mass);
        this.velocityY -= (this.gravity + dragAcceleration) * actualDt;
        
        // y = y + v * dt
        this.positionY += this.velocityY * actualDt;

        // Evitar que la posición se convierta en NaN
        if (isNaN(this.positionY) || isNaN(this.velocityY)) {
            console.warn("Posición o velocidad física se convirtió en NaN. Deteniendo simulación.");
            this.stop();
            return;
        }

        // Detección de colisión con el suelo (Y <= groundY)
        if (this.positionY <= this.groundY) {
            // Posicionar exactamente en el suelo
            this.positionY = this.groundY;

            // Guardar la velocidad de impacto (tomamos el valor absoluto de la velocidad de caída actual)
            this.lastImpactVelocity = Math.abs(this.velocityY);

            // Invertir la velocidad con rebote elástico (restitución)
            this.velocityY = -this.velocityY * this.elasticity;

            // Disparar callback de colisión si existe
            if (this.onCollision) {
                this.onCollision(this.lastImpactVelocity);
            }

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
                console.log(`Rebote físico detectado. Velocidad de rebote: ${this.velocityY.toFixed(2)} m/s, Impacto: ${this.lastImpactVelocity.toFixed(2)} m/s`);
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
