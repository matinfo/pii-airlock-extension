#!/usr/bin/env python3
"""Generate public/_locales/{en,fr,de}/messages.json from one table.
Placeholders: write $1 in a string; it becomes a named placeholder block.
Run: python3 scripts/gen-locales.py"""
import json, re, pathlib

T = {
 # key: (en, fr, de)
 'extName': ('PII Airlock', 'PII Airlock', 'PII Airlock'),
 'extDesc': ('Replaces personal data in your AI chat messages before they are sent.',
             'Remplace les données personnelles de vos messages avant leur envoi à une IA.',
             'Ersetzt personenbezogene Daten in Ihren KI-Chatnachrichten vor dem Senden.'),
 'appName': ('PII Airlock', 'PII Airlock', 'PII Airlock'),
 'chipReplace': ('$1 will be replaced', '$1 sera remplacé', '$1 wird ersetzt'),
 'chipReview': ('$1 to review', '$1 à vérifier', '$1 zu prüfen'),
 'chipNoticed': ('Noticed', 'Repéré', 'Erkannt'),
 'chipPaused': ('Paused', 'En pause', 'Pausiert'),
 'panelLive': ('Replaced when you send', 'Remplacé à l’envoi', 'Wird beim Senden ersetzt'),
 'panelReview': ('Review before sending', 'À vérifier avant l’envoi', 'Vor dem Senden prüfen'),
 'panelAfter': ('Replaced in your last message', 'Remplacé dans votre dernier message', 'In Ihrer letzten Nachricht ersetzt'),
 'subLive': ('Untick anything that should go through as typed.', 'Décochez ce qui doit partir tel quel.', 'Abwählen, was unverändert gesendet werden soll.'),
 'subReview': ('Checked items are replaced with placeholders.', 'Les éléments cochés sont remplacés par des repères.', 'Markierte Einträge werden durch Platzhalter ersetzt.'),
 'subAfter': ('The assistant only saw the placeholders.', 'L’assistant n’a vu que les repères.', 'Der Assistent hat nur die Platzhalter gesehen.'),
 'groupNoticed': ('Noticed, not changed', 'Repéré, non modifié', 'Erkannt, nicht geändert'),
 'btnCancel': ('Cancel', 'Annuler', 'Abbrechen'),
 'btnReplaceSend': ('Replace and send', 'Remplacer et envoyer', 'Ersetzen und senden'),
 'btnReplaceNow': ('Replace now', 'Remplacer maintenant', 'Jetzt ersetzen'),
 'rowAllow': ('Never replace', 'Ne jamais remplacer', 'Nie ersetzen'),
 'rowAlways': ('Always replace', 'Toujours remplacer', 'Immer ersetzen'),
 'rowDontReplace': ('Don’t replace again', 'Ne plus remplacer', 'Nicht mehr ersetzen'),
 'toastOne': ('1 item replaced', '1 élément remplacé', '1 Eintrag ersetzt'),
 'toastMany': ('$1 items replaced', '$1 éléments remplacés', '$1 Einträge ersetzt'),
 'toastDetails': ('Details', 'Détails', 'Details'),
 'namesSkipped': ('Name model still loading; only the built-in name list was used.',
                  'Modèle de noms en cours de chargement ; seule la liste intégrée a servi.',
                  'Namensmodell lädt noch; nur die eingebaute Namensliste wurde genutzt.'),
 'errTitle': ('Couldn’t check this message', 'Impossible de vérifier ce message', 'Nachricht konnte nicht geprüft werden'),
 'errBody': ('The check failed, so nothing is known about this text. It was not sent.',
             'La vérification a échoué, on ne sait rien de ce texte. Il n’a pas été envoyé.',
             'Die Prüfung ist fehlgeschlagen, der Inhalt ist unbekannt. Die Nachricht wurde nicht gesendet.'),
 'failTitle': ('Couldn’t replace the sensitive data', 'Impossible de remplacer les données sensibles', 'Sensible Daten konnten nicht ersetzt werden'),
 'failBody': ('The editor didn’t accept the change, so the message was not sent. Edit it by hand to remove:',
              'L’éditeur n’a pas accepté la modification, le message n’a pas été envoyé. Retirez à la main :',
              'Der Editor hat die Änderung nicht übernommen, die Nachricht wurde nicht gesendet. Bitte manuell entfernen:'),
 'btnEdit': ('Edit message', 'Modifier le message', 'Nachricht bearbeiten'),
 'btnSendUnscanned': ('Send unchecked', 'Envoyer sans vérifier', 'Ungeprüft senden'),
 # popup
 'popActive': ('Protecting this page', 'Cette page est protégée', 'Diese Seite ist geschützt'),
 'popNoComposer': ('No chat box found. Not protected here.', 'Aucune zone de saisie trouvée. Page non protégée.', 'Kein Eingabefeld gefunden. Hier nicht geschützt.'),
 'popUnsupported': ('Not active on this site', 'Inactif sur ce site', 'Auf dieser Seite nicht aktiv'),
 'popOff': ('Protection is off', 'La protection est désactivée', 'Schutz ist ausgeschaltet'),
 'popSiteOff': ('Off for this site', 'Désactivé pour ce site', 'Für diese Seite aus'),
 'popPaused': ('Paused until $1', 'En pause jusqu’à $1', 'Pausiert bis $1'),
 'popSiteToggle': ('Protect $1', 'Protéger $1', '$1 schützen'),
 'popMode': ('Mode', 'Mode', 'Modus'),
 'modeAuto': ('Auto', 'Auto', 'Auto'),
 'modeAutoHint': ('Replaces sensitive data as you send', 'Remplace les données sensibles à l’envoi', 'Ersetzt sensible Daten beim Senden'),
 'modeReview': ('Review', 'Vérifier', 'Prüfen'),
 'modeReviewHint': ('Shows what changes before each send', 'Montre les changements avant chaque envoi', 'Zeigt Änderungen vor jedem Senden'),
 'modeOff': ('Off', 'Désactivé', 'Aus'),
 'modeOffHint': ('Checks nothing', 'Ne vérifie rien', 'Prüft nichts'),
 'popPause': ('Pause for 1 hour', 'Pause d’une heure', '1 Stunde pausieren'),
 'popResume': ('Resume now', 'Reprendre', 'Jetzt fortsetzen'),
 'popScrubbed': ('$1 items replaced so far', '$1 éléments remplacés à ce jour', 'Bisher $1 Einträge ersetzt'),
 'popClear': ('Clear session data', 'Effacer les données de session', 'Sitzungsdaten löschen'),
 'popClearHint': ('Forgets placeholders, your lists and the counter.', 'Oublie les repères, vos listes et le compteur.', 'Vergisst Platzhalter, Ihre Listen und den Zähler.'),
 'popCleared': ('Cleared', 'Effacé', 'Gelöscht'),
 'popNamesOn': ('Better name detection enabled', 'Détection des noms renforcée', 'Bessere Namenserkennung aktiv'),
 'popNamesOnSub': ('Runs on your device, nothing is sent out', 'Fonctionne sur votre appareil, rien n’est envoyé', 'Läuft auf Ihrem Gerät, nichts wird gesendet'),
 'popNamesOff': ('Name detection: basic', 'Détection des noms : de base', 'Namenserkennung: einfach'),
 'popNamesOffSub': ('Unusual names can be missed', 'Les noms rares peuvent échapper', 'Ungewöhnliche Namen können fehlen'),
 'popNamesCta': ('Improve', 'Améliorer', 'Verbessern'),
 'popSettings': ('Settings', 'Réglages', 'Einstellungen'),
 # options
 'optTitle': ('Settings', 'Réglages', 'Einstellungen'),
 'optMode': ('Protection', 'Protection', 'Schutz'),
 'optEntities': ('What gets replaced', 'Ce qui est remplacé', 'Was ersetzt wird'),
 'optEntitiesDesc': ('Override the default for a kind of data.', 'Modifier le comportement pour un type de donnée.', 'Standardverhalten pro Datentyp ändern.'),
 'colType': ('Type', 'Type', 'Typ'),
 'colAction': ('Action', 'Action', 'Aktion'),
 'actDefault': ('Default', 'Par défaut', 'Standard'),
 'actReplace': ('Replace', 'Remplacer', 'Ersetzen'),
 'actAsk': ('Ask first', 'Demander', 'Nachfragen'),
 'actNotice': ('Notice only', 'Signaler seulement', 'Nur melden'),
 'actAllow': ('Leave as is', 'Laisser tel quel', 'Unverändert lassen'),
 'optLists': ('Your lists', 'Vos listes', 'Ihre Listen'),
 'optListsDesc': ('Values you decide about yourself. Stored on this device only, never synced.', 'Valeurs dont vous décidez vous-même. Stockées sur cet appareil uniquement, jamais synchronisées.', 'Werte, über die Sie selbst entscheiden. Nur auf diesem Gerät gespeichert, nie synchronisiert.'),
 'optAllowed': ('Never replace', 'Ne jamais remplacer', 'Nie ersetzen'),
 'optAlways': ('Always replace', 'Toujours remplacer', 'Immer ersetzen'),
 'optAllowedDesc': ('Left as typed, even when detected. Example: your company name.', 'Laissées telles quelles, même détectées. Exemple : le nom de votre entreprise.', 'Bleiben unverändert, auch wenn erkannt. Beispiel: Ihr Firmenname.'),
 'optAlwaysDesc': ('Replaced every time, even when not detected. Example: a project codename.', 'Toujours remplacées, même non détectées. Exemple : le nom de code d’un projet.', 'Immer ersetzt, auch wenn nicht erkannt. Beispiel: ein Projektname.'),
 'optAllowedPh': ('e.g. Acme Corp', 'ex. Acme SA', 'z. B. Acme GmbH'),
 'optAlwaysPh': ('e.g. Project Falcon', 'ex. Projet Faucon', 'z. B. Projekt Falke'),
 'optAdd': ('Add', 'Ajouter', 'Hinzufügen'),
 'optAsKind': ('Replace it as', 'Remplacer comme', 'Ersetzen als'),
 'optInvalid': ('Needs at least 2 characters, including a letter or a digit.', 'Au moins 2 caractères, dont une lettre ou un chiffre.', 'Mindestens 2 Zeichen, mit einem Buchstaben oder einer Ziffer.'),
 'optEmpty': ('Nothing here yet.', 'Rien pour l’instant.', 'Noch nichts vorhanden.'),
 'optRemove': ('Remove', 'Retirer', 'Entfernen'),
 'optReset': ('Reset settings', 'Réinitialiser les réglages', 'Einstellungen zurücksetzen'),
 'optSaved': ('Saved', 'Enregistré', 'Gespeichert'),
 'optFooter': ('Open source. Your text never leaves your browser.', 'Open source. Votre texte ne quitte jamais votre navigateur.', 'Open Source. Ihr Text verlässt nie Ihren Browser.'),
 'nerTitle': ('Better name detection', 'Meilleure détection des noms', 'Bessere Namenserkennung'),
 'nerDesc': ('Finds names the built-in list can miss, best in English, French, German, Spanish, Italian, Portuguese, Dutch and Chinese. It runs on this device. Your messages are never sent anywhere; only the model file is downloaded, once, from huggingface.co (pinned version, checksum verified).',
             'Repère les noms que la liste intégrée peut rater, surtout en anglais, français, allemand, espagnol, italien, portugais, néerlandais et chinois. Tout s’exécute sur cet appareil. Vos messages ne sont jamais envoyés ; seul le fichier du modèle est téléchargé, une fois, depuis huggingface.co (version figée, somme de contrôle vérifiée).',
             'Findet Namen, die die eingebaute Liste übersieht, am besten auf Englisch, Französisch, Deutsch, Spanisch, Italienisch, Portugiesisch, Niederländisch und Chinesisch. Läuft auf diesem Gerät. Ihre Nachrichten werden nie gesendet; nur die Modelldatei wird einmal von huggingface.co geladen (feste Version, Prüfsumme geprüft).'),
 'langTitle': ('Languages', 'Langues', 'Sprachen'),
 'langDesc': ('What is covered, by kind of data.', 'Ce qui est couvert, selon le type de donnée.', 'Was abgedeckt ist, je nach Datentyp.'),
 'langStructured': ('Emails, phones, cards, IBANs, IDs, secrets', 'E-mails, téléphones, cartes, IBAN, identifiants, secrets', 'E-Mails, Telefon, Karten, IBAN, Kennungen, Geheimnisse'),
 'langStructuredVal': ('Any language', 'Toutes les langues', 'Jede Sprache'),
 'langNames': ('Names, built-in', 'Noms, détection intégrée', 'Namen, eingebaut'),
 'langNamesVal': ('Common first names in EN, FR, DE, IT, ES, PT, NL. Not RU, JA, ZH.', 'Prénoms courants en EN, FR, DE, IT, ES, PT, NL. Pas RU, JA, ZH.', 'Häufige Vornamen in EN, FR, DE, IT, ES, PT, NL. Nicht RU, JA, ZH.'),
 'langModel': ('Names, with the model above', 'Noms, avec le modèle ci-dessus', 'Namen, mit dem Modell oben'),
 'langModelVal': ('EN, FR, DE, ES, IT, PT, NL, ZH (also AR, LV). Catches unusual surnames.', 'EN, FR, DE, ES, IT, PT, NL, ZH (aussi AR, LV). Repère les noms rares.', 'EN, FR, DE, ES, IT, PT, NL, ZH (auch AR, LV). Findet seltene Nachnamen.'),
 'nerDownload': ('Download model ($1)', 'Télécharger le modèle ($1)', 'Modell laden ($1)'),
 'nerCancel': ('Cancel', 'Annuler', 'Abbrechen'),
 'nerInstalled': ('Installed ($1 on disk)', 'Installé ($1 sur le disque)', 'Installiert ($1 auf dem Datenträger)'),
 'nerRemove': ('Remove', 'Supprimer', 'Entfernen'),
 'nerFailed': ('Download failed: $1', 'Échec du téléchargement : $1', 'Download fehlgeschlagen: $1'),
 'nerRetry': ('Retry', 'Réessayer', 'Erneut versuchen'),
 # entities
 'ent_EMAIL_ADDRESS': ('Email address', 'Adresse e-mail', 'E-Mail-Adresse'),
 'ent_PHONE_NUMBER': ('Phone number', 'Numéro de téléphone', 'Telefonnummer'),
 'ent_CREDIT_CARD': ('Card number', 'Numéro de carte', 'Kartennummer'),
 'ent_IBAN_CODE': ('IBAN', 'IBAN', 'IBAN'),
 'ent_SSN': ('Social security number', 'Numéro de sécurité sociale', 'Sozialversicherungsnummer'),
 'ent_IP_ADDRESS': ('IP address', 'Adresse IP', 'IP-Adresse'),
 'ent_IP_ADDRESS_PRIVATE': ('Private IP address', 'Adresse IP privée', 'Private IP-Adresse'),
 'ent_CRYPTO': ('Crypto address', 'Adresse crypto', 'Krypto-Adresse'),
 'ent_SECRET_KEY': ('Secret or key', 'Secret ou clé', 'Geheimnis oder Schlüssel'),
 'ent_PERSON': ('Name', 'Nom', 'Name'),
 'ent_LOCATION': ('Place', 'Lieu', 'Ort'),
 'ent_ORG': ('Organisation', 'Organisation', 'Organisation'),
 'ent_DATE_OF_BIRTH': ('Date of birth', 'Date de naissance', 'Geburtsdatum'),
 'ent_FR_NIR': ('French social security no.', 'N° de sécurité sociale (FR)', 'Franz. Sozialversicherungsnr.'),
 'ent_CH_AHV': ('Swiss AVS number', 'N° AVS (CH)', 'AHV-Nummer (CH)'),
 'ent_FR_SIRET': ('SIRET number', 'N° SIRET', 'SIRET-Nummer'),
 'ent_FR_SIREN': ('SIREN number', 'N° SIREN', 'SIREN-Nummer'),
 'ent_DE_TAX_ID': ('German tax ID', 'N° fiscal allemand', 'Steuer-ID'),
 'ent_DE_TAX_NUMBER': ('German tax number', 'N° d’imposition allemand', 'Steuernummer'),
 'ent_IT_VAT_CODE': ('Italian VAT number', 'N° de TVA italien', 'Italienische USt-IdNr.'),
}

root = pathlib.Path(__file__).resolve().parent.parent / 'public' / '_locales'
for i, lang in enumerate(['en', 'fr', 'de']):
    out = {}
    for k, vals in T.items():
        msg = vals[i]
        entry = {'message': msg}
        # chrome.i18n forbids bare $1: use named placeholders
        if re.search(r'\$\d', msg):
            ph = {}
            def sub(m):
                name = f'p{m.group(1)}'
                ph[name] = {'content': f'${m.group(1)}'}
                return f'${name}$'
            entry['message'] = re.sub(r'\$(\d)', sub, msg)
            entry['placeholders'] = ph
        out[k] = entry
    d = root / lang
    d.mkdir(parents=True, exist_ok=True)
    (d / 'messages.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print('ok', len(T))
