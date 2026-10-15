# One Piece card vision model

This pipeline fine-tunes an ImageNet-pretrained MobileNetV3 Small image embedder using supervised contrastive learning, then exports an ONNX model and a gallery of catalog card-image vectors. OpenCV.js remains responsible for finding/rectifying the card; the browser compares the scan embedding against the gallery and returns nearest printings. The existing OCR/catalog path stays as a fallback and confirmation path.

## Prepare labeled images

Use Python 3.12 in a virtual environment, then install the training dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r training\requirements.txt
```

Download the catalog's reference images and labels:

```powershell
python training\prepare_dataset.py
```

For each card folder under `training/data/cards/`, add real camera photos of that exact printing alongside `reference.jpg`. Use varied angle, lighting, sleeves, and distance; keep each printing in its own folder. Catalog reference images alone can bootstrap the embedding model, but synthetic augmentation loss is not a real-world accuracy measure. Real camera photos are needed to tune similarity thresholds and validate reliability.

Train and export:

```powershell
python training\train_model.py --epochs 12
```

The scripts write the model, image gallery, and metadata to `public/assets/card-model/`. The scanner loads the model locally when these files exist; without them it continues using its existing OCR flow.

## Important validation note

The catalog's official card images are useful references, but they do not reproduce glare, sleeves, camera blur, or perspective. Validate with real camera photos that were not used for fine-tuning, especially alternate art and cards with similar artwork. The scanner requires a high nearest-neighbor similarity on repeated frames and still verifies the predicted code against its catalog before adding a card.
