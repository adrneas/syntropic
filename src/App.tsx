
import { WizardLayout } from './components/layout/WizardLayout';
import { Step1Terrain } from './components/wizard/Step1Terrain';
import { Step2Residence } from './components/wizard/Step2Residence';
import { Step3Climate } from './components/wizard/Step3Climate';
import { Step4Preferences } from './components/wizard/Step4Preferences';
import { Step5Summary } from './components/wizard/Step5Summary';
import { useWizardStore } from './store/wizardStore';

function App() {
  const currentStep = useWizardStore(state => state.currentStep);

  return (
    <WizardLayout>
      {currentStep === 1 && <Step1Terrain />}
      {currentStep === 2 && <Step2Residence />}
      {currentStep === 3 && <Step3Climate />}
      {currentStep === 4 && <Step4Preferences />}
      {currentStep === 5 && <Step5Summary />}
    </WizardLayout>
  );
}

export default App;
