/**
 * physics.js - Motor de Físicas y Colisión/Rebote para Web AR
 * Simula la gravedad y el rebote elástico sobre una superficie (suelo real o virtual)
 * extendido con soporte para los 12 principios de animación (Anticipación, Arcos, Timing).
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
        
        // Extensiones de 3D para ARCOS (Trayectoria parabólica)
        this.positionX = 0.0;      // Posición actual en X
        this.velocityX = 0.0;      // Velocidad actual en X
        this.positionZ = 0.0;      // Posición actual en Z
        this.velocityZ = 0.0;      // Velocidad actual en Z
        
        this.isSimulating = false; // Estado de la simulación
        this.lastImpactVelocity = 0.0; // Velocidad con la que impactó en el último rebote
        this.onCollision = null;   // Callback disparado al impactar con el suelo (recibe la velocidad de impacto)
        this.onJumpStart = null;   // Callback cuando el objeto despega (después de anticipación)
        
        // Variables para la ANTICIPACIÓN
        this.isAnticipating = false;
        this.anticipationTimer = 0.0;
        this.anticipationDuration = 0.35; // Duración de la compresión previa (segundos)
        this.anticipationSquash = 1.0;     // Factor de deformación de anticipación
        this.pendingAction = null;         // Acción a ejecutar después del wind-up
        
        // Interruptores de los 12 Principios
        this.principles = {
            squashStretch: false,
            anticipation: false,
            staging: false,
            poseGhosts: false,
            followThrough: false,
            slowInOut: false,
            arcs: false,
            secondaryAction: false,
            timing: false,
            exaggeration: false,
            solidDrawing: false,
            appeal: false
        };
        this.exaggeration = 1.0;   // Multiplicador de exageración (0.0 a 3.0)
        this.motionMode = 'straight'; // 'straight' (físicas directas) o 'pose' (pose a pose)
    }

    /**
     * Aplica un ajuste rápido a las físicas basadas en un preajuste de Ritmo.
     * @param {string} preset - El preset a aplicar ('rubber', 'heavy', 'jelly', 'feather')
     */
    applyTimingPreset(preset) {
        if (preset === 'rubber') {
            this.gravity = 9.8;
            this.elasticity = 0.75;
            this.friction = 0.15;
            this.mass = 1.0;
        } else if (preset === 'heavy') {
            this.gravity = 22.0;
            this.elasticity = 0.12;
            this.friction = 0.25;
            this.mass = 8.0;
        } else if (preset === 'jelly') {
            this.gravity = 6.5;
            this.elasticity = 0.6;
            this.friction = 0.08;
            this.mass = 0.4;
        } else if (preset === 'feather') {
            this.gravity = 2.5;
            this.elasticity = 0.05;
            this.friction = 1.9;
            this.mass = 0.15;
        }
    }

    /**
     * Sincroniza la posición horizontal del motor de físicas con la posición real del modelo.
     * DEBE llamarse antes de startDrop() o applyImpulse() para evitar que el modelo
     * se teletransporte al origen del mundo (0,0,0).
     * @param {number} x - Coordenada X del modelo en el mundo
     * @param {number} z - Coordenada Z del modelo en el mundo
     */
    setStartPosition(x, z) {
        this.positionX = isNaN(x) ? 0.0 : x;
        this.positionZ = isNaN(z) ? 0.0 : z;
    }

    /**
     * Inicia una caída libre desde la altura especificada.
     * @param {number} groundY - Coordenada Y del suelo sobre el que rebotar
     */
    startDrop(groundY = 0.0) {
        this.groundY = isNaN(groundY) ? 0.0 : groundY;
        const targetPosY = this.groundY + (isNaN(this.dropHeight) ? 1.2 : this.dropHeight);
        
        // Si la anticipación está activa, programar wind-up primero
        if (this.principles.anticipation) {
            this.isAnticipating = true;
            this.anticipationTimer = 0.0;
            this.anticipationSquash = 1.0;
            this.pendingAction = {
                type: 'drop',
                posY: targetPosY
            };
            this.velocityY = 0.0;
            this.velocityX = 0.0;
            this.velocityZ = 0.0;
            console.log(`Anticipación de caída iniciada. Altura objetivo: ${targetPosY}m, Posición XZ: (${this.positionX.toFixed(3)}, ${this.positionZ.toFixed(3)})`);
        } else {
            this.positionY = targetPosY;
            this.velocityY = 0.0;
            this.velocityX = 0.0;
            this.velocityZ = 0.0;
            this.isSimulating = true;
            console.log(`Físicas iniciadas. Altura de caída: ${this.positionY}m, Suelo: ${this.groundY}m, Pos XZ: (${this.positionX.toFixed(3)}, ${this.positionZ.toFixed(3)})`);
        }
    }

    /**
     * Aplica un impulso vertical instantáneo (salto) al objeto con soporte para arcos y anticipación.
     * @param {number} velocityY - Velocidad inicial hacia arriba (ej: 6.0 m/s)
     * @param {number} velX - Velocidad inicial en X (opcional)
     * @param {number} velZ - Velocidad inicial en Z (opcional)
     */
    applyImpulse(velocityY, velX = 0.0, velZ = 0.0) {
        if (this.principles.anticipation) {
            this.isAnticipating = true;
            this.anticipationTimer = 0.0;
            this.anticipationSquash = 1.0;
            this.pendingAction = {
                type: 'jump',
                velY: velocityY,
                velX: velX,
                velZ: velZ
            };
            console.log(`Anticipación de salto iniciada. Impulso Y planificado: ${velocityY} m/s`);
        } else {
            this.velocityY = velocityY;
            this.velocityX = velX;
            this.velocityZ = velZ;
            this.isSimulating = true;
            if (this.onJumpStart) this.onJumpStart();
            console.log(`Físicas: Impulso aplicado directo: Y=${velocityY} m/s, X=${velX}, Z=${velZ}`);
        }
    }

    /**
     * Detiene la simulación de físicas.
     */
    stop() {
        this.isSimulating = false;
        this.isAnticipating = false;
        this.velocityY = 0.0;
        this.velocityX = 0.0;
        this.velocityZ = 0.0;
        this.anticipationSquash = 1.0;
    }

    /**
     * Actualiza el estado de las físicas usando integración de Euler y principios dinámicos.
     * @param {number} dt - Tiempo transcurrido en segundos (delta time)
     * @param {Function} onUpdate - Callback ejecutado con la nueva posición (y, x, z)
     * @param {Function} onSettle - Callback ejecutado cuando el objeto se asienta en reposo
     */
    update(dt, onUpdate, onSettle) {
        // Validar delta time
        if (isNaN(dt) || dt <= 0) return;
        const maxDt = 0.1;
        const actualDt = Math.min(dt, maxDt);

        // 1. Manejar estado de Anticipación (Compresión previa)
        if (this.isAnticipating) {
            this.anticipationTimer += actualDt;
            const progress = Math.min(1.0, this.anticipationTimer / this.anticipationDuration);
            
            // Squash de anticipación: Curva sinusoidal para comprimir y luego liberar el resorte
            // Se comprime hasta un 20% (multiplicado por la exageración)
            const maxCompression = 0.20 * this.exaggeration;
            this.anticipationSquash = 1.0 - maxCompression * Math.sin(progress * Math.PI);
            
            if (progress >= 1.0) {
                // Finalizar anticipación y ejecutar acción pendiente
                this.isAnticipating = false;
                this.anticipationSquash = 1.0;
                
                if (this.pendingAction) {
                    if (this.pendingAction.type === 'drop') {
                        this.positionY = this.pendingAction.posY;
                        this.velocityY = 0.0;
                        this.velocityX = 0.0;
                        this.velocityZ = 0.0;
                    } else if (this.pendingAction.type === 'jump') {
                        this.velocityY = this.pendingAction.velY;
                        this.velocityX = this.pendingAction.velX;
                        this.velocityZ = this.pendingAction.velZ;
                    }
                    this.isSimulating = true;
                    this.pendingAction = null;
                    if (this.onJumpStart) this.onJumpStart();
                }
            }

            if (onUpdate) {
                onUpdate(this.positionY, this.positionX, this.positionZ);
            }
            return;
        }

        if (!this.isSimulating) return;

        // Validar propiedades físicas críticas
        if (isNaN(this.gravity) || isNaN(this.elasticity) || isNaN(this.groundY) || isNaN(this.mass) || isNaN(this.friction)) {
            console.warn("Propiedades físicas contienen NaN. Deteniendo simulación.");
            this.stop();
            return;
        }

        // 2. Principio: Slow In and Slow Out (Flotabilidad en el ápice)
        let currentGravity = this.gravity;
        if (this.principles.slowInOut && Math.abs(this.velocityY) < 2.5 && this.positionY > this.groundY + 0.1) {
            // Cuando la velocidad vertical está cerca del cero absoluto (ápice del salto/rebote),
            // reducimos la gravedad para crear la ilusión de flotado (salidas/entradas suaves)
            const speedRatio = Math.abs(this.velocityY) / 2.5;
            const floatScale = 0.45 + 0.55 * speedRatio; // Escala entre 45% y 100% de gravedad
            currentGravity = this.gravity * floatScale;
        }

        // 3. Integración de Euler en eje Y
        const dragY = (this.friction * this.velocityY) / Math.max(0.01, this.mass);
        this.velocityY -= (currentGravity + dragY) * actualDt;
        this.positionY += this.velocityY * actualDt;

        // 4. Integración de Euler en ejes horizontales (Arcos)
        if (this.principles.arcs) {
            const dragX = (this.friction * this.velocityX) / Math.max(0.01, this.mass);
            const dragZ = (this.friction * this.velocityZ) / Math.max(0.01, this.mass);
            this.velocityX -= dragX * actualDt;
            this.velocityZ -= dragZ * actualDt;
            this.positionX += this.velocityX * actualDt;
            this.positionZ += this.velocityZ * actualDt;
        } else {
            // Sin arcos: mantener la posición horizontal fija (no mover a 0,0)
            this.velocityX = 0.0;
            this.velocityZ = 0.0;
            // positionX y positionZ NO se modifican para preservar la ubicación del modelo
        }

        // Evitar NaNs accidentales
        if (isNaN(this.positionY) || isNaN(this.velocityY) || isNaN(this.positionX) || isNaN(this.positionZ)) {
            console.warn("Físicas produjeron NaN. Deteniendo simulación.");
            this.stop();
            return;
        }

        // 5. Detección de Colisión e Impacto con el Suelo (Y <= groundY)
        if (this.positionY <= this.groundY) {
            this.positionY = this.groundY;
            this.lastImpactVelocity = Math.abs(this.velocityY);

            // Invertir la velocidad vertical con el coeficiente de rebote
            this.velocityY = -this.velocityY * this.elasticity;

            // Si hay movimiento horizontal (Arcos), amortiguar el avance al rebotar
            if (this.principles.arcs) {
                // Conservar parte de la velocidad horizontal pero perdiendo fuerza por fricción de impacto
                const horizontalDamp = 0.65; // Factor de fricción con el suelo
                this.velocityX = this.velocityX * horizontalDamp;
                this.velocityZ = this.velocityZ * horizontalDamp;
            }

            // Invocar el callback de colisión para efectos secundarios
            if (this.onCollision) {
                this.onCollision(this.lastImpactVelocity);
            }

            // Comprobar si el objeto entra en reposo absoluto
            const velocityThreshold = 0.15; // Límite mínimo de rebote
            const horizontalSpeed = Math.hypot(this.velocityX, this.velocityZ);
            
            if (this.velocityY < velocityThreshold && horizontalSpeed < velocityThreshold) {
                this.velocityY = 0.0;
                this.velocityX = 0.0;
                this.velocityZ = 0.0;
                this.positionY = this.groundY;
                this.isSimulating = false;
                
                if (onSettle) {
                    onSettle();
                }
                console.log("El modelo se ha asentado en el suelo de manera definitiva.");
            } else {
                console.log(`Rebote físico: Impacto Y=${this.lastImpactVelocity.toFixed(2)} m/s, Rebote Y=${this.velocityY.toFixed(2)} m/s, HorizontalSpeed=${horizontalSpeed.toFixed(2)} m/s`);
            }
        }

        // Ejecutar callback con la nueva posición tridimensional calculada
        if (onUpdate) {
            onUpdate(this.positionY, this.positionX, this.positionZ);
        }
    }
}

// Registrar globalmente
window.PhysicsEngine = PhysicsEngine;
