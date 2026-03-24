import botanicalData from '../data/botanical.json';
import infrastructureData from '../data/infrastructure.json';
import type { ISpecies, ClimateZone } from '../types/botanical';
import type { IInfrastructure } from '../types/infrastructure';

const speciesList = botanicalData as ISpecies[];
const infraList = infrastructureData as IInfrastructure[];

export const dataService = {
  /**
   * Returns botanical species, optionally filtered by climate
   */
  getBotanicalData: (climateFilter?: ClimateZone): ISpecies[] => {
    if (!climateFilter) return speciesList;
    return speciesList.filter(species => species.climateCompatibility.includes(climateFilter));
  },
  
  /**
   * Returns all available infrastructure options
   */
  getInfrastructureData: (): IInfrastructure[] => {
    return infraList;
  }
};
