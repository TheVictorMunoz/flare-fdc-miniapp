// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/**
 * @title Web2JsonConsumer
 * @notice Reference on-chain consumer for the FDC Web2Json attestation used by
 *         this miniapp. The frontend verifies proofs by calling the canonical
 *         FdcVerification contract directly (no deploy needed), but this shows
 *         how your own contract would trust and store attested Web2 data.
 *
 *         The `abiEncodedData` inside the proof is the ABI encoding of the
 *         struct you declared in the request's `abiSignature`. Here it matches
 *         the default Star Wars example in app/page.tsx.
 */
contract Web2JsonConsumer {
    struct StarWarsCharacter {
        string name;
        uint256 height;
        uint256 mass;
        uint256 numberOfFilms;
        uint256 uid;
    }

    StarWarsCharacter[] public characters;

    event CharacterAdded(uint256 indexed uid, string name);

    error InvalidProof();

    /**
     * @dev Verifies the FDC proof against the on-chain Merkle root, then
     *      decodes and stores the attested data. Reverts if the proof does not
     *      match a root finalized by Flare's validators.
     */
    function addCharacter(IWeb2Json.Proof calldata proof) external {
        if (!_isValid(proof)) revert InvalidProof();

        StarWarsCharacter memory c = abi.decode(
            proof.data.responseBody.abiEncodedData,
            (StarWarsCharacter)
        );

        characters.push(c);
        emit CharacterAdded(c.uid, c.name);
    }

    function _isValid(IWeb2Json.Proof calldata proof)
        internal
        view
        returns (bool)
    {
        return ContractRegistry.getFdcVerification().verifyWeb2Json(proof);
    }

    function count() external view returns (uint256) {
        return characters.length;
    }
}
