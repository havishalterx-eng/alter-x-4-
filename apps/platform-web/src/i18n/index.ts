import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import enCommon from "./locales/en/common.json"
import hiCommon from "./locales/hi/common.json"

const resources = {
  en: {
    common: enCommon
  },
  hi: {
    common: hiCommon
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem("alterx_lang") || "en",
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false // React already escapes values
    }
  })

export default i18n
