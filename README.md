# Almetal Integrated Margin System

Este repositorio contiene el código fuente para el **Sistema de Márgenes Integrado de Almetal**, desarrollado sobre la plataforma NetSuite utilizando SuiteScript. Además, incluye módulos para la integración de documentos con servidores Synology.

## 📁 Estructura del Proyecto

El proyecto sigue la estructura estándar del SuiteCloud Development Framework (SDF) de NetSuite:

```text
src/FileCabinet/SuiteScripts/
├── Integracion_Synology/
│   ├── Lib_2_1_Synology_integration.js   # Librería principal para conexión con API de Synology
│   └── lib_documentos_synology.js        # Manejo y procesamiento de documentos hacia/desde Synology
├── sistema_margenes/
│   ├── CM_Margin_System_Core.js          # Módulo Custom/Core con la lógica central de márgenes
│   ├── CS_Margin_System.js               # Client Script para validaciones e interacciones en la UI
│   └── UE_Margin_System_Keeper.js        # User Event Script para procesamiento en el servidor al guardar/cargar registros
