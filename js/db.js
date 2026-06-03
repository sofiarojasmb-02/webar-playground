/**
 * db.js - Gestor de Persistencia IndexedDB para Modelos 3D
 * Permite almacenar y recuperar los últimos 3 modelos utilizados como Blobs.
 */

class WebARDB {
    constructor() {
        this.dbName = 'WebARModelsDB';
        this.storeName = 'models';
        this.version = 1;
        this.db = null;
    }

    /**
     * Inicializa la base de datos IndexedDB
     */
    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error('Error al abrir la base de datos:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB inicializada con éxito.');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    /**
     * Guarda un archivo (Blob) en la base de datos.
     * Mantiene como máximo los 3 modelos más recientes eliminando el más antiguo si es necesario.
     * @param {Blob} fileBlob - Archivo del modelo en formato Blob
     * @param {string} fileName - Nombre del archivo
     */
    async saveModel(fileBlob, fileName) {
        if (!this.db) await this.init();

        return new Promise(async (resolve, reject) => {
            try {
                // Obtener todos los modelos guardados
                const currentModels = await this.getRecentModels();

                // Si hay 3 o más modelos, eliminar el más antiguo
                if (currentModels.length >= 3) {
                    // Ordenar por timestamp de menor a mayor (más antiguo primero)
                    currentModels.sort((a, b) => a.timestamp - b.timestamp);
                    const toDeleteCount = currentModels.length - 2; // Dejar espacio para el nuevo
                    for (let i = 0; i < toDeleteCount; i++) {
                        await this.deleteModel(currentModels[i].id);
                        console.log(`Modelo antiguo eliminado para hacer espacio: ${currentModels[i].name}`);
                    }
                }

                // Crear objeto del nuevo modelo
                const modelEntry = {
                    name: fileName,
                    type: fileBlob.type || this._getFileExtension(fileName),
                    data: fileBlob,
                    timestamp: Date.now()
                };

                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.add(modelEntry);

                request.onsuccess = () => {
                    console.log(`Modelo '${fileName}' guardado con éxito.`);
                    resolve(request.result);
                };

                request.onerror = (event) => {
                    console.error('Error al guardar modelo en DB:', event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Obtiene los modelos almacenados ordenados por fecha (más recientes primero)
     * @returns {Promise<Array>} Lista de modelos
     */
    async getRecentModels() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const models = request.result || [];
                // Ordenar por timestamp descendente (más nuevos primero)
                models.sort((a, b) => b.timestamp - a.timestamp);
                resolve(models.slice(0, 3));
            };

            request.onerror = (event) => {
                console.error('Error al obtener modelos de la DB:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Elimina un modelo de la base de datos por su ID
     * @param {number} id - ID del modelo a borrar
     */
    async deleteModel(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                console.error(`Error al eliminar modelo con id ${id}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Helper para inferir la extensión si el mime-type está vacío
     */
    _getFileExtension(fileName) {
        const parts = fileName.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }
}

// Exportar instancia global
window.webarDB = new WebARDB();
