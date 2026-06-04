/**
 * deform.js - Módulo de Deformación de Malla y Estilizado de Materiales
 * Implementa la deformación directa de vértices (Estirar / Comprimir con conservación de volumen)
 * y el cambio dinámico de color y propiedades del material.
 */

class MeshDeformer {
    constructor() {
        // Ninguno, clase utilitaria
    }

    /**
     * Aplica deformación directa sobre los vértices del modelo.
     * Estira o comprime verticalmente relativo a la base del objeto,
     * y aplica la escala inversa en los ejes horizontales para conservar volumen.
     * @param {THREE.Object3D} model - El modelo a deformar
     * @param {number} factorY - Factor de deformación (1.0 = original, >1.0 = estirado, <1.0 = comprimido)
     */
    applyDeformation(model, factorY) {
        if (!model) return;

        // 1. Obtener la caja delimitadora (Bounding Box) del modelo para calcular la base (yMin)
        // Asegurar que las matrices del modelo están actualizadas
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        
        // El punto de base Y en coordenadas del mundo
        const yMinWorld = box.min.y;

        // 2. Recorrer todas las mallas para modificar sus vértices directamente
        model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const geometry = child.geometry;

                // Verificar si es necesario clonar y guardar las posiciones originales
                if (!geometry.userData.originalPositions) {
                    // Guardar clon del buffer de posiciones original
                    geometry.userData.originalPositions = geometry.attributes.position.clone();
                }

                const origPositions = geometry.userData.originalPositions;
                const positions = geometry.attributes.position;
                const count = positions.count;

                // Calcular matrices de transformación
                // Matriz para convertir de local de la malla a coordenadas del mundo
                const localToWorld = child.matrixWorld.clone();
                // Matriz para convertir de mundo de vuelta a local de la malla
                const worldToLocal = localToWorld.clone().invert();

                const tempVertex = new THREE.Vector3();

                for (let i = 0; i < count; i++) {
                    // Obtener posición original del vértice
                    tempVertex.fromBufferAttribute(origPositions, i);

                    // Transformar a coordenadas del mundo
                    tempVertex.applyMatrix4(localToWorld);

                    // Aplicar deformación en el espacio del mundo relativo a yMinWorld
                    const dy = tempVertex.y - yMinWorld;
                    
                    // Y escala por el factorY
                    tempVertex.y = yMinWorld + dy * factorY;
                    
                    // Conservación del volumen: X y Z se escalan por 1 / sqrt(factorY)
                    const horizontalScale = 1.0 / Math.sqrt(factorY);
                    
                    // Para que la deformación horizontal sea respecto al centro del objeto
                    const centerX = (box.min.x + box.max.x) / 2;
                    const centerZ = (box.min.z + box.max.z) / 2;
                    
                    tempVertex.x = centerX + (tempVertex.x - centerX) * horizontalScale;
                    tempVertex.z = centerZ + (tempVertex.z - centerZ) * horizontalScale;

                    // Transformar de vuelta al espacio local de la malla
                    tempVertex.applyMatrix4(worldToLocal);

                    // Guardar nuevo valor en el buffer de posiciones activo
                    positions.setXYZ(i, tempVertex.x, tempVertex.y, tempVertex.z);
                }

                // Notificar a Three.js que los vértices han cambiado y recalcular normales/límites
                positions.needsUpdate = true;
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
            }
        });
    }

    /**
     * Cambia dinámicamente el color de todos los materiales del modelo.
     * @param {THREE.Object3D} model - El modelo 3D
     * @param {string} hexColor - Color hexadecimal (ej: "#ff00ff")
     */
    changeColor(model, hexColor) {
        if (!model) return;
        const color = new THREE.Color(hexColor);

        model.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material) => {
                    // Actualizar el color difuso
                    if (material.color) {
                        material.color.copy(color);
                    }
                    
                    // Si el material tiene emisividad, podemos darle un toque sutil de brillo tecnológico
                    if (material.emissive) {
                        material.emissive.copy(color).multiplyScalar(0.05); // Brillo muy tenue
                    }
                    
                    material.needsUpdate = true;
                });
            }
        });
    }

    /**
     * Actualiza las propiedades físicas del material (rugosidad y metalizado).
     * @param {THREE.Object3D} model - El modelo 3D
     * @param {number} roughness - Factor de rugosidad (0.0 a 1.0)
     * @param {number} metalness - Factor de metalizado (0.0 a 1.0)
     */
    changeMaterialProperties(model, roughness, metalness) {
        if (!model) return;

        model.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material) => {
                    // Solo los materiales estándar o físicos de Three.js soportan roughness/metalness
                    if ('roughness' in material) {
                        material.roughness = roughness;
                    }
                    if ('metalness' in material) {
                        material.metalness = metalness;
                    }
                    material.needsUpdate = true;
                });
            }
        });
    }

    /**
     * Cambia el tipo de material del modelo reconstruyendo su shader para soportar refracción de vidrio, etc.
     * @param {THREE.Object3D} model - El modelo 3D
     * @param {string} type - Tipo de material ('solid', 'aluminum', 'glass', 'wood', 'ceramic')
     */
    changeMaterialType(model, type) {
        if (!model) return;

        model.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                const updatedMaterials = materials.map((oldMat) => {
                    const prevColor = oldMat.color ? oldMat.color.clone() : new THREE.Color(0x8b5cf6);
                    const prevMap = oldMat.map;

                    let newMat;
                    if (type === 'glass') {
                        // Vidrio refractivo de alta calidad usando MeshPhysicalMaterial
                        newMat = new THREE.MeshPhysicalMaterial({
                            color: prevColor,
                            roughness: 0.1,
                            metalness: 0.1,
                            transmission: 0.9,     // Habilitar refracción
                            ior: 1.5,             // Índice de refracción
                            thickness: 0.5,        // Grosor del vidrio
                            transparent: true,
                            opacity: 0.6,
                            shadowSide: THREE.DoubleSide
                        });
                    } else if (type === 'aluminum') {
                        newMat = new THREE.MeshStandardMaterial({
                            color: prevColor,
                            roughness: 0.2,
                            metalness: 0.9,
                            shadowSide: THREE.DoubleSide
                        });
                    } else if (type === 'wood') {
                        newMat = new THREE.MeshStandardMaterial({
                            color: prevColor,
                            roughness: 0.8,
                            metalness: 0.0,
                            shadowSide: THREE.DoubleSide
                        });
                    } else if (type === 'ceramic') {
                        newMat = new THREE.MeshStandardMaterial({
                            color: prevColor,
                            roughness: 0.95,
                            metalness: 0.0,
                            shadowSide: THREE.DoubleSide
                        });
                    } else {
                        // solid / estándar
                        newMat = new THREE.MeshStandardMaterial({
                            color: prevColor,
                            roughness: 0.4,
                            metalness: 0.8,
                            shadowSide: THREE.DoubleSide
                        });
                    }

                    if (prevMap) newMat.map = prevMap;
                    return newMat;
                });

                child.material = Array.isArray(child.material) ? updatedMaterials : updatedMaterials[0];
                child.material.needsUpdate = true;
            }
        });
    }
}

// Exportar clase globalmente
window.MeshDeformer = MeshDeformer;
