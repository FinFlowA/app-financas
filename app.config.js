// Estende o app.json. O google-services.json (Firebase/FCM, usado pelo push no
// Android) fica fora do git: no EAS Build ele chega pela variável de ambiente
// do tipo arquivo GOOGLE_SERVICES_JSON; localmente, usa o arquivo da raiz.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
