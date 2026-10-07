"""Check imports and the ML runtime using generated data; this is not a CSI model."""
import sys

import dotenv
import numpy as np
import pandas as pd
import requests
import scipy
import serial
import sklearn
from sklearn.ensemble import RandomForestClassifier


def main():
    features = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)
    labels = np.array([0, 0, 1, 1])
    model = RandomForestClassifier(n_estimators=10, random_state=42)
    model.fit(features, labels)
    assert model.predict(features).tolist() == labels.tolist()
    print(f"Python {sys.version.split()[0]} environment ready.")
    print(f"NumPy {np.__version__}, SciPy {scipy.__version__}, pandas {pd.__version__}")
    print(f"scikit-learn {sklearn.__version__}, pyserial {serial.__version__}, requests {requests.__version__}")
    print("Generated-data RandomForest smoke check passed. No CSI training was performed.")


if __name__ == "__main__":
    main()
