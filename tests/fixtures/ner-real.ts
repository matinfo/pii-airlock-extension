/** Captured from the REAL Xenova/bert-base-multilingual-cased-ner-hrl (q8) via transformers.js 4.x
 * `pipeline('token-classification')`. Per-wordpiece, BIO, no offsets. Do not hand-edit. */
import type { NerToken } from '../../lib/detection/ner';

export const REAL: Record<string, NerToken[]> = {
  "please ask Oluwaseun Adeyemi-Okonkwo to call back": [
    {
      "entity": "B-PER",
      "score": 0.9999,
      "index": 5,
      "word": "Ol"
    },
    {
      "entity": "I-PER",
      "score": 0.8709,
      "index": 6,
      "word": "##uwa"
    },
    {
      "entity": "I-PER",
      "score": 0.9997,
      "index": 7,
      "word": "##se"
    },
    {
      "entity": "I-PER",
      "score": 0.9996,
      "index": 8,
      "word": "##un"
    },
    {
      "entity": "I-PER",
      "score": 0.9993,
      "index": 9,
      "word": "Ad"
    },
    {
      "entity": "I-PER",
      "score": 0.9986,
      "index": 10,
      "word": "##eye"
    },
    {
      "entity": "I-PER",
      "score": 0.9887,
      "index": 11,
      "word": "##mi"
    },
    {
      "entity": "I-PER",
      "score": 0.7928,
      "index": 13,
      "word": "Oko"
    },
    {
      "entity": "I-PER",
      "score": 0.9633,
      "index": 14,
      "word": "##nk"
    },
    {
      "entity": "I-PER",
      "score": 0.9329,
      "index": 15,
      "word": "##wo"
    }
  ],
  "Please email Jean Dupont-Lachapelle about the invoice.": [
    {
      "entity": "B-PER",
      "score": 0.9997,
      "index": 3,
      "word": "Jean"
    },
    {
      "entity": "I-PER",
      "score": 0.9995,
      "index": 4,
      "word": "Dupont"
    },
    {
      "entity": "I-PER",
      "score": 0.9997,
      "index": 5,
      "word": "-"
    },
    {
      "entity": "I-PER",
      "score": 0.9997,
      "index": 6,
      "word": "Lac"
    },
    {
      "entity": "I-PER",
      "score": 0.9995,
      "index": 7,
      "word": "##ha"
    },
    {
      "entity": "I-PER",
      "score": 0.9989,
      "index": 8,
      "word": "##pelle"
    }
  ],
  "Élodie Martin lives in Genève and works at Nestlé.": [
    {
      "entity": "B-PER",
      "score": 0.9998,
      "index": 1,
      "word": "Él"
    },
    {
      "entity": "I-PER",
      "score": 0.986,
      "index": 2,
      "word": "##odie"
    },
    {
      "entity": "I-PER",
      "score": 0.9989,
      "index": 3,
      "word": "Martin"
    },
    {
      "entity": "B-LOC",
      "score": 0.9998,
      "index": 6,
      "word": "Genève"
    },
    {
      "entity": "B-ORG",
      "score": 0.9998,
      "index": 10,
      "word": "Nest"
    },
    {
      "entity": "I-ORG",
      "score": 0.9999,
      "index": 11,
      "word": "##lé"
    }
  ],
  "My name is Zoë van der Berg.": [
    {
      "entity": "B-PER",
      "score": 0.9623,
      "index": 4,
      "word": "Zo"
    },
    {
      "entity": "I-PER",
      "score": 0.9852,
      "index": 5,
      "word": "##ë"
    },
    {
      "entity": "I-PER",
      "score": 0.9587,
      "index": 6,
      "word": "van"
    },
    {
      "entity": "I-PER",
      "score": 0.9619,
      "index": 7,
      "word": "der"
    },
    {
      "entity": "I-PER",
      "score": 0.9849,
      "index": 8,
      "word": "Berg"
    }
  ]
};
