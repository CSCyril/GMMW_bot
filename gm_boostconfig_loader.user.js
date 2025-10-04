// ==UserScript==
// @name         GoMining BoostConfig Loader (Dynamic Config List)
// @version      2.0
// @description  Charge la configuration des boosts depuis un document externe, aplatie, avec timings et min/max
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      githubusercontent.com
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// ==/UserScript==

(function () {
    // URL de base des configurations
    const BASE_CONFIG_URL = "https://raw.githubusercontent.com/CSCyril/GMMW_bot/main/";
    // URL de l'API GitHub pour lister les fichiers dans le répertoire
    const GITHUB_API_URL = "https://api.github.com/repos/CSCyril/GMMW_bot/contents/";
    // Fonction pour obtenir le nom de la configuration à partir du stockage local
    function getStoredConfigName() {
        return localStorage.getItem("gomining_config_name") || 'config';
    }
    // Fonction pour construire l'URL de la configuration
    function getConfigUrl(configName) {
        return `${BASE_CONFIG_URL}${configName}`;
    }
    // Fonction pour résoudre la configuration
    function resolveConfig(raw) {
        const { boostIds, config } = raw;
        const flatConfig = {};
        const timeRanges = {};
        const levelRanges = {};
        for (const [groupName, group] of Object.entries(config)) {
            levelRanges[groupName] = {};
            for (const [levelName, level] of Object.entries(group)) {
                levelRanges[groupName][levelName] = { min: level.min, max: level.max };
                for (const [multKey, multConfig] of Object.entries(level.config)) {
                    const key = `${groupName}_${levelName}_${multKey}`;
                    const boosts = (multConfig.boosts || [])
                        .map(entry => {
                            if (!entry.boostId) return null;
                            const originalId = entry.boostId;
                            const uuid = boostIds[originalId] || originalId;
                            return {
                                boostId: uuid,
                                count: entry.count,
                                priority: entry.priority,
                                timing: entry.timing
                            };
                        })
                        .filter(Boolean);
                    flatConfig[key] = {
                        timeRanges: multConfig.timeRanges || level.timeRanges || [],
                        boosts
                    };
                    timeRanges[key] = flatConfig[key].timeRanges;
                }
            }
        }
        return { boostConfig: flatConfig, timeRanges, levelRanges };
    }
    // Fonction pour charger la configuration
    function loadConfig(configName) {
        const configUrl = getConfigUrl(configName);
        GM_xmlhttpRequest({
            method: "GET",
            url: configUrl,
            headers: { "Accept": "application/json" },
            onload: (res) => {
                try {
                    const raw = JSON.parse(res.responseText);
                    const parsed = resolveConfig(raw);
                    localStorage.setItem("gomining_boost_config", JSON.stringify(parsed.boostConfig));
                    localStorage.setItem("gomining_time_ranges", JSON.stringify(parsed.timeRanges));
                    localStorage.setItem("gomining_level_ranges", JSON.stringify(parsed.levelRanges));
                    localStorage.setItem("gomining_config_name", configName);
                    console.log(`[TM:Config] 📦 Boost config '${configName}' corrigée enregistrée avec succès`);
                } catch (e) {
                    console.warn(`[TM:Config] ❌ Erreur parsing config '${configName}':`, e);
                    alert(`Erreur lors du chargement de la configuration '${configName}': ${e.message}`);
                }
            },
            onerror: (err) => {
                console.warn(`[TM:Config] ❌ Erreur HTTP config '${configName}':`, err);
                alert(`Erreur HTTP lors du chargement de la configuration '${configName}': ${err.statusText}`);
            }
        });
    }
    // Fonction pour créer l'interface utilisateur
    function createConfigSelector(configs) {
        // Créer un élément de sélection
        const configSelector = document.createElement('select');
        configSelector.id = 'gomining-config-selector';
        // Ajouter une option par défaut
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Sélectionnez une configuration...';
        configSelector.appendChild(defaultOption);
        // Obtenir la configuration actuelle
        const currentConfig = getStoredConfigName();
        // Ajouter une option pour chaque configuration disponible
        configs.forEach(config => {
            const option = document.createElement('option');
            option.value = config.name;
            option.textContent = config.name;
            if (config.name === currentConfig) {
                option.selected = true;
            }
            configSelector.appendChild(option);
        });
        // Ajouter un bouton pour charger la configuration sélectionnée
        const loadButton = document.createElement('button');
        loadButton.textContent = ' Charger';
        loadButton.onclick = () => {
            const selectedConfig = configSelector.value;
            if (selectedConfig) {
                loadConfig(selectedConfig);
            } else {
                alert('Veuillez sélectionner une configuration.');
            }
        };
        // Créer un conteneur pour l'interface utilisateur
        const configContainer = document.createElement('div');
        configContainer.style.position = 'fixed';
        configContainer.style.top = '70px';
        configContainer.style.right = '10px';
        configContainer.style.zIndex = '9999';
        configContainer.style.backgroundColor = '#242533';
        configContainer.style.padding = '10px';
        configContainer.style.border = '1px solid #ccc';
        configContainer.style.borderRadius = '5px';
        configContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        // Ajouter les éléments à l'interface utilisateur
        configContainer.appendChild(configSelector);
        configContainer.appendChild(loadButton);
        // Ajouter l'interface utilisateur à la page
        document.body.appendChild(configContainer);
        // Charger la configuration stockée par défaut
        if (currentConfig) {
            loadConfig(currentConfig);
        }
    }
    // Fonction pour obtenir la liste des configurations disponibles
    function fetchConfigList() {
        GM_xmlhttpRequest({
            method: "GET",
            url: GITHUB_API_URL,
            headers: { "Accept": "application/json" },
            onload: (res) => {
                try {
                    const response = JSON.parse(res.responseText);
                    // Vérifier si la réponse est un tableau
                    if (Array.isArray(response)) {
                        const configs = response
                            .filter(file => file.type === 'file' && !file.name.includes('.'))
                            .map(file => ({ name: file.name }));
                        if (configs.length === 0) {
                            console.warn("[TM:Config] ❌ Aucun fichier de configuration trouvé.");
                            alert("Aucun fichier de configuration trouvé dans le répertoire racine.");
                        } else {
                            createConfigSelector(configs);
                        }
                    } else {
                        // Si la réponse n'est pas un tableau, vérifier si c'est un objet avec une propriété 'message'
                        if (response.message) {
                            throw new Error(`Erreur de l'API GitHub: ${response.message}`);
                        } else {
                            throw new Error("La réponse de l'API n'est pas un tableau et ne contient pas de message d'erreur.");
                        }
                    }
                } catch (e) {
                    console.warn("[TM:Config] ❌ Erreur parsing la liste des configurations :", e);
                    alert(`Erreur lors de la récupération de la liste des configurations : ${e.message}`);
                }
            },
            onerror: (err) => {
                console.warn("[TM:Config] ❌ Erreur HTTP lors de la récupération de la liste des configurations :", err);
                alert(`Erreur HTTP lors de la récupération de la liste des configurations : ${err.statusText}`);
            }
        });
    }
    // Obtenir la liste des configurations disponibles lorsque la page est chargée
    window.addEventListener('load', fetchConfigList);
})();
