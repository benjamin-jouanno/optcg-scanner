# One Piece card vision model

This pipeline fine-tunes an ImageNet-pretrained MobileNetV3 Small image embedder using supervised contrastive learning, then exports an ONNX model and a gallery of catalog card-image vectors. OpenCV.js remains responsible for finding/rectifying the card; the browser compares the scan embedding against the gallery and returns nearest printings. The existing OCR/catalog path stays as a fallback and confirmation path.

## Prepare labeled images

Use Python 3.12 in a virtual environment, then install the training dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r training\requirements.txt
```

For a photo-by-photo desktop workflow, run the standalone labeler (it is separate from the Angular app):

```powershell
python training\tools\label_card_photos.py
```

Use **Take photos with webcam** to capture up to 200 photos per app session. Rotate the preview left or right in 90-degree steps to match the scanner, take photos, then choose **Done — label photos** to add them to the queue. Use **Upload photos** to add existing images as before. Label each image and use `Copy label from previous photo` for multiple angles of the same printing. The export defaults to `training/data/cards/`, where the trainer expects the card folders and `card.json` files. Alternative-art labels require the printing suffix (for example, `r1` or `p1`) so its generated code stays distinct.

Download the catalog's reference images and labels:

```powershell
python training\prepare_dataset.py
```

For each card folder under `training/data/cards/`, add real camera photos of that exact printing alongside `reference.jpg`. Use varied angle, lighting, sleeves, and distance; keep each printing in its own folder. Catalog reference images alone can bootstrap the embedding model, but synthetic augmentation loss is not a real-world accuracy measure. Real camera photos are needed to tune similarity thresholds and validate reliability.

Train and export. The console shows live batch progress, loss, elapsed time, and estimated time remaining. Training saves a checkpoint after every completed epoch at `training/checkpoints/one-piece-cards.checkpoint.pt`. Later runs automatically resume the model and optimizer from that checkpoint, while `--epochs` means additional epochs for the current session. Because earlier runs exported ONNX only and did not save training checkpoints, the first run with this change starts from pretrained ImageNet weights; subsequent runs continue from the saved checkpoint:

```powershell
python training\train_model.py --epochs 12
```

To intentionally ignore the checkpoint and begin a new run from ImageNet MobileNetV3 weights, pass `--fresh`. To keep a separate training history, pass a different path with `--checkpoint`.

The checkpoint stays under `training/checkpoints/` and is not shipped with the app. The ONNX model, image gallery, and metadata are written to `public/assets/card-model/`; the scanner loads those inference files and does not load the training checkpoint.

## Important validation note

The catalog's official card images are useful references, but they do not reproduce glare, sleeves, camera blur, or perspective. Validate with real camera photos that were not used for fine-tuning, especially alternate art and cards with similar artwork. The scanner requires a high nearest-neighbor similarity on repeated frames and still verifies the predicted code against its catalog before adding a card.
